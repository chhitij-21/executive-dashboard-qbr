// frontend/src/components/ConnectorsPanel.tsx
// Real-Time IT Connectors (Cisco Meraki & Catalyst Center Webhooks) UI (Item #19 — Strict TypeScript)

import React, { useState, useEffect, useCallback } from 'react';
import { Plug, Plus, RotateCw, Trash2, Power, Activity, Copy, CheckCircle, AlertTriangle } from 'lucide-react';
import { API_BASE_URL, apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';
import type { Anomaly, ConnectorProvider, WebhookConnector, WebhookEvent } from '../../../shared/types/qbr';

interface BufferedIncidentRow {
  webhookEventId?: string;
  IncidentNumber?: string;
  DeviceID?: string;
  DeviceType?: string;
  SiteID?: string;
  RCA?: string;
  Priority?: string;
  Subject?: string;
}

interface RevealedSecretState {
  id: string;
  name: string;
  provider: ConnectorProvider;
  secret: string;
}

export default function ConnectorsPanel(): React.ReactElement {
  const { isAdmin, activeClient } = useAuth() as {
    isAdmin: boolean;
    activeClient?: { id?: string; name?: string } | null;
  };
  const clientId = activeClient?.id || 'client-jfl';

  const [connectors, setConnectors] = useState<WebhookConnector[]>([]);
  const [bufferedIncidents, setBufferedIncidents] = useState<BufferedIncidentRow[]>([]);
  const [liveAnomalies, setLiveAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [provider, setProvider] = useState<ConnectorProvider>('meraki');
  const [name, setName] = useState<string>('');
  const [sharedSecret, setSharedSecret] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const [revealedSecret, setRevealedSecret] = useState<RevealedSecretState | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);

  const [selectedConnector, setSelectedConnector] = useState<WebhookConnector | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, bufRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/api/v1/connectors?clientId=${encodeURIComponent(clientId)}`),
        apiFetch(`${API_BASE_URL}/api/v1/webhooks/buffered-incidents?clientId=${encodeURIComponent(clientId)}`),
      ]);
      const connJson = (await connRes.json().catch(() => ({}))) as {
        connectors?: WebhookConnector[];
        error?: string;
      };
      if (!connRes.ok) throw new Error(connJson.error || `Failed to load connectors (HTTP ${connRes.status})`);
      setConnectors(Array.isArray(connJson.connectors) ? connJson.connectors : []);

      if (bufRes.ok) {
        const bufJson = (await bufRes.json().catch(() => ({}))) as {
          incidents?: BufferedIncidentRow[];
          anomalies?: Anomaly[];
        };
        setBufferedIncidents(Array.isArray(bufJson.incidents) ? bufJson.incidents : []);
        setLiveAnomalies(Array.isArray(bufJson.anomalies) ? bufJson.anomalies : []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load IT connectors');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadData();
    setSelectedConnector(null);
    setEvents([]);
  }, [loadData]);

  const handleCreateConnector = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          provider,
          name: name.trim(),
          ...(sharedSecret.trim() ? { sharedSecret: sharedSecret.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        connector?: WebhookConnector;
        error?: string;
      };
      if (!res.ok || !json.connector) throw new Error(json.error || `Creation failed (HTTP ${res.status})`);
      setRevealedSecret({
        id: json.connector.id,
        name: json.connector.name,
        provider: json.connector.provider,
        secret: json.connector.webhookSecret || '',
      });
      setCopiedSecret(false);
      setName('');
      setSharedSecret('');
      setActionMsg(`Provisioned ${json.connector.name}. Copy the one-time HMAC secret below.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleEnabled = async (conn: WebhookConnector): Promise<void> => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/connectors/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !conn.enabled, clientId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Update failed');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleRotateSecret = async (conn: WebhookConnector): Promise<void> => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/connectors/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotateSecret: true, clientId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        connector?: WebhookConnector;
        error?: string;
      };
      if (!res.ok || !json.connector) throw new Error(json.error || 'Secret rotation failed');
      setRevealedSecret({
        id: json.connector.id,
        name: json.connector.name,
        provider: json.connector.provider,
        secret: json.connector.webhookSecret || '',
      });
      setCopiedSecret(false);
      setActionMsg(`Rotated HMAC secret for ${conn.name}. Update your vendor webhook header.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Secret rotation failed');
    }
  };

  const handleDelete = async (conn: WebhookConnector): Promise<void> => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/connectors/${conn.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'Delete failed');
      }
      if (selectedConnector?.id === conn.id) {
        setSelectedConnector(null);
        setEvents([]);
      }
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleInspectEvents = async (conn: WebhookConnector): Promise<void> => {
    setSelectedConnector(conn);
    setLoadingEvents(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/connectors/${conn.id}/events`);
      const json = (await res.json().catch(() => ({}))) as {
        events?: WebhookEvent[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || 'Failed to load events');
      setEvents(Array.isArray(json.events) ? json.events : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleFlushBuffer = async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/webhooks/flush`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const json = (await res.json().catch(() => ({}))) as { flushed?: number; error?: string };
      if (!res.ok) throw new Error(json.error || 'Flush failed');
      setActionMsg(`Flushed ${json.flushed || 0} buffered webhook event(s) to processed state.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Flush failed');
    }
  };

  const getIngestEndpoint = (prov: ConnectorProvider | string, id: string): string => {
    const slug = prov === 'catalyst_center' ? 'catalyst' : prov === 'meraki' ? 'meraki' : 'ingest';
    return `/api/v1/webhooks/${slug}/${id}`;
  };

  return (
    <div style={{ maxWidth: '1380px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          color: '#ffffff',
          borderRadius: '12px',
          padding: '1.5rem 1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ padding: '0.65rem', backgroundColor: 'rgba(255, 255, 255, 0.14)', borderRadius: '10px' }}>
            <Plug size={24} color="#38bdf8" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#ffffff' }}>
              Real-Time IT Connectors & Webhook Engine ({activeClient?.name || clientId})
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.84rem', color: '#cbd5e1' }}>
              HMAC-SHA256 verified event ingestion for Cisco Meraki & Cisco Catalyst Center with automatic RCA classification and anomaly triggers.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {actionMsg && (
        <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: '0.85rem', fontWeight: 600 }}>
          {actionMsg}
        </div>
      )}

      {revealedSecret && (
        <div
          data-testid="one-time-webhook-secret"
          style={{
            padding: '1rem 1.25rem',
            borderRadius: '10px',
            backgroundColor: '#fffbeb',
            border: '1.5px solid #f59e0b',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ fontWeight: 700, color: '#92400e', fontSize: '0.9rem' }}>
            One-Time HMAC Signing Secret for {revealedSecret.name} — Copy Now
          </div>
          <div style={{ fontSize: '0.8rem', color: '#78350f' }}>
            Endpoint URL: <code>{getIngestEndpoint(revealedSecret.provider, revealedSecret.id)}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <code style={{ padding: '0.4rem 0.7rem', backgroundColor: '#ffffff', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '0.82rem', color: '#0f172a' }}>
              {revealedSecret.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(revealedSecret.secret).catch(() => {});
                setCopiedSecret(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.38rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #d97706',
                backgroundColor: '#fef3c7',
                color: '#92400e',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              {copiedSecret ? <CheckCircle size={14} /> : <Copy size={14} />}
              <span>{copiedSecret ? 'Copied' : 'Copy Secret'}</span>
            </button>
          </div>
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={(e) => void handleCreateConnector(e)}
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '1rem 1.25rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ConnectorProvider)}
              style={{ padding: '0.45rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            >
              <option value="meraki">Cisco Meraki</option>
              <option value="catalyst_center">Cisco Catalyst Center</option>
              <option value="generic">Generic Webhook</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: '200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Connector Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Store Meraki Alerts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ padding: '0.45rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '180px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>Meraki sharedSecret (Optional)</label>
            <input
              type="text"
              placeholder="Optional fallback secret"
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
              style={{ padding: '0.45rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontSize: '0.84rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Plus size={15} />
            <span>{creating ? 'Creating...' : 'Create Connector'}</span>
          </button>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
        {loading ? (
          <div style={{ padding: '1.5rem', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', color: '#64748b' }}>
            Loading connectors...
          </div>
        ) : connectors.length === 0 ? (
          <div style={{ padding: '1.5rem', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', color: '#64748b' }}>
            No webhook connectors provisioned for {activeClient?.name || clientId}.
          </div>
        ) : (
          connectors.map((c) => (
            <div
              key={c.id}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: selectedConnector?.id === c.id ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                padding: '1rem 1.2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', padding: '0.15rem 0.45rem', borderRadius: '5px', backgroundColor: '#e0f2fe', color: '#0369a1' }}>
                    {c.provider}
                  </span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{c.name}</h3>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '999px',
                    backgroundColor: c.enabled ? '#dcfce7' : '#f1f5f9',
                    color: c.enabled ? '#166534' : '#64748b',
                  }}
                >
                  {c.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              <div style={{ fontSize: '0.78rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div>Ingest Path: <code>{getIngestEndpoint(c.provider, c.id)}</code></div>
                <div>Secret Preview: <code>{c.secretPreview}</code> • Events: <strong>{c.eventCount}</strong></div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => void handleInspectEvents(c)}
                  style={{ padding: '0.32rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Inspect Events
                </button>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleToggleEnabled(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.32rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      <Power size={12} />
                      <span>{c.enabled ? 'Disable' : 'Enable'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRotateSecret(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.32rem 0.65rem', borderRadius: '6px', border: '1px solid #fde68a', backgroundColor: '#fffbeb', color: '#92400e', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      <RotateCw size={12} />
                      <span>Rotate Secret</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.32rem 0.65rem', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {selectedConnector && (
        <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1rem 1.25rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
            Ingested Events — {selectedConnector.name}
          </h3>
          {loadingEvents ? (
            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>Loading connector events...</div>
          ) : events.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>No webhook events ingested for this connector yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    <th style={{ padding: '0.5rem' }}>Occurred At</th>
                    <th style={{ padding: '0.5rem' }}>Event Type</th>
                    <th style={{ padding: '0.5rem' }}>Severity</th>
                    <th style={{ padding: '0.5rem' }}>Device / Site</th>
                    <th style={{ padding: '0.5rem' }}>RCA Hint</th>
                    <th style={{ padding: '0.5rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{new Date(ev.occurredAt).toLocaleString()}</td>
                      <td style={{ padding: '0.5rem', fontWeight: 700 }}>{ev.eventType}</td>
                      <td style={{ padding: '0.5rem' }}>{ev.severity}</td>
                      <td style={{ padding: '0.5rem' }}>{ev.deviceId} ({ev.deviceType}) • {ev.siteId}</td>
                      <td style={{ padding: '0.5rem' }}>{ev.rcaHint}</td>
                      <td style={{ padding: '0.5rem' }}>{ev.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1.15rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#2563eb" />
            <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: '#0f172a' }}>
              Live Webhook Event Buffer ({bufferedIncidents.length} Staged Incidents)
            </h3>
          </div>
          {isAdmin && bufferedIncidents.length > 0 && (
            <button
              type="button"
              onClick={() => void handleFlushBuffer()}
              style={{
                padding: '0.38rem 0.85rem',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Flush Buffer to Processed
            </button>
          )}
        </div>

        {liveAnomalies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {liveAnomalies.map((anom) => (
              <div
                key={anom.id}
                style={{
                  padding: '0.55rem 0.8rem',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  fontSize: '0.8rem',
                  color: '#991b1b',
                }}
              >
                <strong>[{anom.severity}] {anom.type}:</strong> {anom.message}
              </div>
            ))}
          </div>
        )}

        {bufferedIncidents.length === 0 ? (
          <div style={{ fontSize: '0.84rem', color: '#64748b' }}>
            Webhook event buffer is currently empty. Incoming signed alerts stage here automatically.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '0.45rem' }}>Ref</th>
                  <th style={{ padding: '0.45rem' }}>Device</th>
                  <th style={{ padding: '0.45rem' }}>Site</th>
                  <th style={{ padding: '0.45rem' }}>RCA Hint</th>
                  <th style={{ padding: '0.45rem' }}>Priority</th>
                  <th style={{ padding: '0.45rem' }}>Subject</th>
                </tr>
              </thead>
              <tbody>
                {bufferedIncidents.slice(0, 10).map((inc) => (
                  <tr key={inc.webhookEventId || inc.IncidentNumber} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.45rem', fontWeight: 600 }}>{inc.IncidentNumber}</td>
                    <td style={{ padding: '0.45rem' }}>{inc.DeviceID} ({inc.DeviceType})</td>
                    <td style={{ padding: '0.45rem' }}>{inc.SiteID}</td>
                    <td style={{ padding: '0.45rem' }}>{inc.RCA}</td>
                    <td style={{ padding: '0.45rem' }}>{inc.Priority}</td>
                    <td style={{ padding: '0.45rem', color: '#475569' }}>{inc.Subject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
