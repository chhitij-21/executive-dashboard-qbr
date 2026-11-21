// backend/routes/jobRoutes.js
const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const clientService = require('../services/clientService');
const { requireAuth } = require('../middleware/auth');

function resolveRequestTenant(req) {
  const rawId = req.headers['x-client-id'] ||
                req.headers['x-tenant-id'] ||
                req.query.clientId ||
                req.user?.assignedClient ||
                'client-jfl';
  return clientService.resolveCanonicalClientId(rawId) || 'client-jfl';
}

// GET /api/jobs/:jobId - Poll job state with tenant authorization
router.get('/:jobId', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const reqTenantId = resolveRequestTenant(req);

    const job = await queueService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
    }

    const isAdmin = req.user?.role === 'admin';
    const jobTenantId = clientService.resolveCanonicalClientId(job.clientId);

    if (!isAdmin && jobTenantId !== reqTenantId) {
      return res.status(403).json({
        error: 'Forbidden: Access to this job is restricted to its customer.',
        code: 'TENANT_FORBIDDEN',
      });
    }

    return res.json({
      success: true,
      job: {
        jobId: job.jobId,
        clientId: job.clientId,
        status: job.status,
        progress: job.progress || 0,
        stage: job.stage || 'queued',
        message: job.message || '',
        fileNames: job.fileNames || [],
        reportPeriod: job.reportPeriod || null,
        resultUrl: job.resultUrl || null,
        downloadUrl: job.downloadUrl || null,
        error: job.error || null,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs: job.durationMs,
      },
    });
  } catch (err) {
    console.error('[jobRoutes] Error querying job:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// DELETE /api/jobs/:jobId - Cancel an active or queued job
router.delete('/:jobId', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const reqTenantId = resolveRequestTenant(req);

    const job = await queueService.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
    }

    const isAdmin = req.user?.role === 'admin';
    const jobTenantId = clientService.resolveCanonicalClientId(job.clientId);

    if (!isAdmin && jobTenantId !== reqTenantId) {
      return res.status(403).json({
        error: 'Forbidden: Access to this job is restricted to its customer.',
        code: 'TENANT_FORBIDDEN',
      });
    }

    const cancelled = await queueService.cancelJob(jobId, job.clientId);
    if (!cancelled) {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled (it may have already completed or failed).',
      });
    }

    return res.json({
      success: true,
      message: 'Job cancelled successfully.',
      jobId,
    });
  } catch (err) {
    console.error('[jobRoutes] Error cancelling job:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

module.exports = router;
