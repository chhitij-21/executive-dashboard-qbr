// backend/routes/v1/webhookRoutes.js
// Real-Time IT Connectors: Webhook Ingestion & Connector Management API (Item #19)

'use strict';

const express = require('express');
const router = express.Router();
const connectorService = require('../../services/connectorService');
const clientService = require('../../services/clientService');
const auditService = require('../../services/auditService');
const { detectAnomalies } = require('../../services/validators/anomalyDetector');
const { requireAuth, requireAdmin, requireClientAccess } = require('../../middleware/auth');

const extractClientId = (req) =>
  req.body?.clientId ||
  req.body?.tenantId ||
  req.query?.clientId ||
  req.query?.client ||
  req.query?.tenantId ||
  req.headers['x-client-id'] ||
  (req.user?.assignedClient && req.user.assignedClient !== 'all' ? req.user.assignedClient : 'client-jfl');

// ── List Connectors for Tenant ──────────────────────────────────────────────
router.get(['/connectors', '/api/connectors'], requireAuth, requireClientAccess(extractClientId), async (req, res) => {
  try {
    const tenantId = req.targetClientId;
    const connectors = await connectorService.listConnectors(tenantId);
    res.json({ success: true, clientId: tenantId, connectors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Create Connector (Admin Only, Tenant-Scoped) ────────────────────────────
router.post(['/connectors', '/api/connectors'], requireAuth, requireAdmin, requireClientAccess(extractClientId), async (req, res) => {
  try {
    const tenantId = req.targetClientId;
    const { provider, name, sharedSecret, webhookSecret } = req.body || {};
    const connector = await connectorService.createConnector({
      tenantId,
      provider,
      name,
      sharedSecret,
      webhookSecret,
    });

    auditService.logEvent({
      eventType: 'WEBHOOK_CONNECTOR_CREATED',
      severity: 'INFO',
      tenantId,
      user: req.user,
      req,
      resourceType: 'webhook_connector',
      resourceId: connector.id,
      action: 'CREATE',
      status: 'SUCCESS',
      details: { provider: connector.provider, name: connector.name },
    }).catch(() => {});

    res.status(201).json({
      success: true,
      clientId: tenantId,
      connector,
      note: 'Store webhookSecret securely — it will not be displayed again in plain text.',
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Update / Toggle / Rotate Secret on Connector (Admin Only) ───────────────
router.patch(['/connectors/:connectorId', '/api/connectors/:connectorId'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await connectorService.getConnectorById(req.params.connectorId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Connector not found', code: 'CONNECTOR_NOT_FOUND' });
    }

    const explicitClient = req.body?.clientId || req.query?.clientId || req.headers['x-client-id'];
    if (explicitClient) {
      const canonical = clientService.resolveCanonicalClientId(explicitClient);
      if (canonical && canonical !== existing.tenantId) {
        return res.status(403).json({ success: false, error: 'Connector does not belong to specified tenant', code: 'CUSTOMER_ISOLATION_VIOLATION' });
      }
    }

    const { enabled, name, rotateSecret, sharedSecret } = req.body || {};
    const updated = await connectorService.updateConnector(existing.id, existing.tenantId, {
      enabled,
      name,
      rotateSecret: Boolean(rotateSecret),
      sharedSecret,
    });

    auditService.logEvent({
      eventType: rotateSecret ? 'WEBHOOK_SECRET_ROTATED' : 'WEBHOOK_CONNECTOR_UPDATED',
      severity: rotateSecret ? 'WARN' : 'INFO',
      tenantId: existing.tenantId,
      user: req.user,
      req,
      resourceType: 'webhook_connector',
      resourceId: existing.id,
      action: 'UPDATE',
      status: 'SUCCESS',
      details: { enabled: updated.enabled, rotated: Boolean(rotateSecret) },
    }).catch(() => {});

    res.json({ success: true, connector: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Delete Connector (Admin Only) ───────────────────────────────────────────
router.delete(['/connectors/:connectorId', '/api/connectors/:connectorId'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await connectorService.getConnectorById(req.params.connectorId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Connector not found', code: 'CONNECTOR_NOT_FOUND' });
    }

    const deleted = await connectorService.deleteConnector(existing.id, existing.tenantId);
    auditService.logEvent({
      eventType: 'WEBHOOK_CONNECTOR_DELETED',
      severity: 'WARN',
      tenantId: existing.tenantId,
      user: req.user,
      req,
      resourceType: 'webhook_connector',
      resourceId: existing.id,
      action: 'DELETE',
      status: deleted ? 'SUCCESS' : 'FAILURE',
      details: { provider: existing.provider, name: existing.name },
    }).catch(() => {});

    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Inspect Ingested Events for Connector (Tenant-Isolated) ─────────────────
router.get(['/connectors/:connectorId/events', '/api/connectors/:connectorId/events'], requireAuth, async (req, res) => {
  try {
    const existing = await connectorService.getConnectorById(req.params.connectorId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Connector not found', code: 'CONNECTOR_NOT_FOUND' });
    }

    if (req.user.role !== 'admin') {
      const assigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
      if (assigned !== existing.tenantId) {
        auditService.logEvent({
          eventType: 'SECURITY_ACCESS_DENIED',
          severity: 'WARN',
          tenantId: assigned,
          user: req.user,
          req,
          resourceType: 'webhook_connector',
          resourceId: existing.id,
          action: 'READ',
          status: 'FAILURE',
          details: { reason: 'FORBIDDEN_TENANT_ACCESS', targetTenant: existing.tenantId },
        }).catch(() => {});
        return res.status(403).json({ success: false, error: 'Forbidden: Cross-tenant connector access denied', code: 'FORBIDDEN_TENANT_ACCESS' });
      }
    }

    const { status, severity, limit, offset } = req.query;
    const result = await connectorService.listConnectorEvents({
      connectorId: existing.id,
      tenantId: existing.tenantId,
      status,
      severity,
      limit,
      offset,
    });

    res.json({ success: true, connectorId: existing.id, clientId: existing.tenantId, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Retrieve Buffered Incidents + Live Anomaly Preview for Tenant ───────────
router.get(['/webhooks/buffered-incidents', '/api/webhooks/buffered-incidents'], requireAuth, requireClientAccess(extractClientId), async (req, res) => {
  try {
    const tenantId = req.targetClientId;
    const site = req.query?.site || null;
    const status = req.query?.status || 'buffered';

    const incidents = await connectorService.getBufferedIncidentsForTenant(tenantId, { site, status });
    const anomalyPreview = detectAnomalies({
      devices: [],
      incidents,
      siteSummary: [],
      executiveSummary: { totalIncidents: incidents.length, slaTarget: 99.3 },
    }, { freeze: false });

    res.json({
      success: true,
      clientId: tenantId,
      total: incidents.length,
      incidents,
      anomalies: anomalyPreview.anomalies || [],
      anomalySummary: anomalyPreview.summary || { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Flush Buffered Webhook Events to Processed State ────────────────────────
router.post(['/webhooks/flush', '/api/webhooks/flush'], requireAuth, requireAdmin, requireClientAccess(extractClientId), async (req, res) => {
  try {
    const tenantId = req.targetClientId;
    const eventIds = Array.isArray(req.body?.eventIds) ? req.body.eventIds : null;
    const result = await connectorService.flushBufferedEvents(tenantId, eventIds);

    auditService.logEvent({
      eventType: 'WEBHOOK_BUFFER_FLUSHED',
      severity: 'INFO',
      tenantId,
      user: req.user,
      req,
      resourceType: 'webhook_events',
      action: 'UPDATE',
      status: 'SUCCESS',
      details: { flushed: result.flushed },
    }).catch(() => {});

    res.json({ success: true, clientId: tenantId, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Public Vendor Webhook Ingestion Handlers (HMAC-SHA256 / sharedSecret) ───
function handleWebhookIngest(providerHint) {
  return async (req, res) => {
    try {
      const connectorId = req.params.connectorId;
      const result = await connectorService.ingestWebhookEvent({
        connectorId,
        providerHint,
        rawBody: req.rawBody,
        parsedBody: req.body,
        headers: req.headers,
      });

      if (result.error) {
        if (result.status === 401) {
          auditService.logEvent({
            eventType: 'WEBHOOK_SIGNATURE_FAILED',
            severity: 'WARN',
            tenantId: result.connector?.tenantId || null,
            req,
            resourceType: 'webhook_connector',
            resourceId: connectorId,
            action: 'INGEST',
            status: 'FAILURE',
            details: { providerHint, method: result.method, reason: result.error },
          }).catch(() => {});
        }
        return res.status(result.status).json({
          success: false,
          error: result.error,
          code: result.code,
        });
      }

      if (!result.duplicate) {
        auditService.logEvent({
          eventType: 'WEBHOOK_EVENT_INGESTED',
          severity: result.event.severity === 'CRITICAL' ? 'WARN' : 'INFO',
          tenantId: result.connector.tenantId,
          req,
          resourceType: 'webhook_event',
          resourceId: result.event.id,
          action: 'INGEST',
          status: 'SUCCESS',
          details: {
            connectorId: result.connector.id,
            provider: result.connector.provider,
            eventType: result.event.eventType,
            deviceId: result.event.deviceId,
            siteId: result.event.siteId,
            method: result.method,
          },
        }).catch(() => {});
      }

      return res.status(result.status).json({
        success: true,
        duplicate: result.duplicate,
        method: result.method,
        event: result.event,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

router.post(['/webhooks/meraki/:connectorId', '/api/webhooks/meraki/:connectorId'], handleWebhookIngest('meraki'));
router.post(['/webhooks/catalyst/:connectorId', '/api/webhooks/catalyst/:connectorId'], handleWebhookIngest('catalyst_center'));
router.post(['/webhooks/ingest/:connectorId', '/api/webhooks/ingest/:connectorId'], handleWebhookIngest('generic'));

module.exports = router;

