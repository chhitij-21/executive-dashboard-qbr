// backend/index.js — Executive Report Dashboard API
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();
const fs = require('fs');

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const { processJFLWorkbooks, filterDashboardBySite } = require('./services/processData');
// generatePPT is imported here so the download helper can regenerate a fresh PPT
// from the job's own dashboard_data.json whenever the pre-generated file is missing.
// This is the SSOT guarantee: the PPT always reflects the exact same data as the dashboard.
const { generatePPT } = require('./services/pptGenerator');

const clientService = require('./services/clientService');
const historyService = require('./services/historyService');
const { validateUpload } = require('./services/uploadValidationService');
const authService = require('./services/authService');
const ruleEngine = require('./services/ruleEngine');
const { migrate } = require('./db/migrate');
const { healthCheck } = require('./config/database');
const sentry = require('./utils/sentry');
const { logger } = require('./utils/logger');
const { loggingMiddleware } = require('./middleware/loggingMiddleware');

const app = express();

// Initialize Sentry SDK (Item #15)
sentry.initSentry(app);

// Global unhandled error safety nets
process.on('unhandledRejection', (reason) => {
  sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    module: 'process',
    operation: 'unhandledRejection',
  });
});

process.on('uncaughtException', (err) => {
  sentry.captureException(err, { module: 'process', operation: 'uncaughtException' });
});

// 1. Sentry Request Handler
app.use(sentry.sentryRequestHandler());

// 2. Pino Correlation & Request Logger Middleware
app.use(loggingMiddleware);

// ── CORS: only allow explicit origins from ALLOWED_ORIGINS + localhost for dev ─
// SECURITY FIX (FINDING-008): Removed wildcard *.onrender.com — any Render app
// could previously make credentialed requests to this server.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    try {
      const hostname = new URL(origin).hostname;
      // Development: allow localhost
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      // Production: only explicitly configured origins
      const isAllowed = ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o));

      if (isLocalhost || isAllowed) return callback(null, true);
    } catch (e) { }

    callback(new Error(`CORS: Origin ${origin} is not allowed.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Service-Pass'],
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// ── Inline rate limiter for auth routes (FINDING-009) ─────────────────────────
// Limits each IP to 20 login attempts per 15 minutes without a new dependency.
const _authRateMap = new Map();
const AUTH_LIMIT = 20;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

function authRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const record = _authRateMap.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > AUTH_WINDOW_MS) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count += 1;
  _authRateMap.set(ip, record);

  if (record.count > AUTH_LIMIT) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
  }
  next();
}

const _heavyRateMap = new Map();
function resetRateLimits() {
  _authRateMap.clear();
  _heavyRateMap.clear();
  try {
    const authService = require('./services/authService');
    if (typeof authService.resetRateLimits === 'function') {
      authService.resetRateLimits();
    }
  } catch (_) {}
}
app.resetRateLimits = resetRateLimits;
const HEAVY_LIMIT = 30; // max 30 heavy upload/analysis ops per 15 mins
function heavyRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const record = _heavyRateMap.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > AUTH_WINDOW_MS) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count += 1;
  _heavyRateMap.set(ip, record);

  if (record.count > HEAVY_LIMIT) {
    return res.status(429).json({ error: 'Rate limit exceeded for report generation and analysis. Please try again shortly.' });
  }
  next();
}

const schedulerService = require('./services/schedulerService');
if (process.env.NODE_ENV !== 'test') {
  schedulerService.initSchedulers().catch((err) => {
    console.warn('[server] SchedulerService initialization warning:', err.message);
  });
}

// Graceful deployment shutdown handler for SIGTERM and SIGINT
const gracefulShutdown = (signal) => {
  console.log(`[server] Received ${signal}. Stopping standing schedulers...`);
  try {
    schedulerService.stopAll();
  } catch (err) {
    console.warn('[server] Error stopping scheduler:', err.message);
  }
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


const queueService = require('./services/queueService');
queueService.initialize().catch((err) => {
  console.warn('[server] QueueService initialization warning:', err.message);
});

queueService.registerProcessor(async (jobState, jobData) => {
  if (!jobData) return;
  const jobId = jobState.jobId;
  const clientId = jobState.clientId;
  const client = clientService.getClientById(clientId);
  const clientName = jobData.clientName || client?.name || 'Client';

  const unlock = await queueService.acquireTenantLock(clientId, jobId);

  try {
    await queueService.executeWithWatchdog(jobId, clientId, async (signal) => {
      await queueService.updateProgress(jobId, 10, 'upload_validation', 'Validating staged input files...');

      const dirs = clientService.ensureTenantDirs(clientId);
      const outputDir = path.join(dirs.reportsDir, `job_${jobId}`);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      await queueService.updateProgress(jobId, 25, 'parsing_excel', 'Parsing Excel workbooks...');

      const result = await processJFLWorkbooks(jobData.incidentPath, jobData.inventoryPath, outputDir, {
        clientId,
        clientName,
        ruleConfigFile: jobData.ruleConfigFile || client?.ruleConfigFile,
        startDate: jobData.startDate,
        endDate: jobData.endDate,
        reportingPeriod: jobData.reportingPeriod,
        periodMode: jobData.periodMode,
        customSheetMapping: jobData.customSheetMapping,
        signal,
        waitForPPT: true,
        onProgress: async (pct, msg, stg) => {
          await queueService.updateProgress(jobId, pct, stg, msg);
        },
      });

      if (!result || !result.success) {
        throw new Error(result?.error || 'Report processing failed validation.');
      }

      const dashboardPath = result?.dashboardPath || path.join(outputDir, 'dashboard_data.json');
      const pptPath = result?.pptPath || path.join(outputDir, `${client?.code || 'CLIENT'}_QBR_Report.pptx`);

      jobs[jobId] = {
        jobId,
        clientId,
        status: 'completed',
        dashboardPath,
        pptPath,
        reportPath: result?.reportPath || null,
        dataQualityPath: result?.dataQualityPath || null,
        processingLogPath: result?.processingLogPath || null,
      };

      historyService.recordReport({
        jobId,
        clientId,
        clientName,
        location: jobData.location || 'All Locations',
        reportPeriod: jobData.historyPeriodLabel || jobData.reportingPeriod,
        uploadedBy: jobData.uploadedBy || 'System User',
        status: 'completed',
        dashboardPath,
        pptPath,
        reportPath: result?.reportPath || null,
        dataQualityPath: result?.dataQualityPath || null,
        processingLogPath: result?.processingLogPath || null,
        error: null,
      });
      historyService.cleanupOldReports(3);

      // Dual-write to reports_tickets for MMTC only
      try {
        if (jobData.incidentPath && fs.existsSync(jobData.incidentPath)) {
          const { parseTicketExcel, dualWriteToReportsTickets } = require('./services/reportUpload');
          const { rows } = parseTicketExcel(fs.readFileSync(jobData.incidentPath));
          const canonical = clientService.resolveCanonicalClientId(clientId);
          const pStart = jobData.startDate || null;
          const pEnd = jobData.endDate || null;
          const isTestEnv = process.env.NODE_ENV === 'test';
          const { parseTicketDate } = require('./services/reportService');
          const dStart = pStart ? new Date(`${pStart}T00:00:00Z`) : null;
          const dEnd = pEnd ? new Date(`${pEnd}T23:59:59Z`) : null;

          const realTickets = (rows || []).filter(t => {
            const acc = (t['Account Name'] || '').toString().toLowerCase();
            if (acc && !acc.includes('mmtc')) return false;
            const tn = String(t['Ticket Number'] || t.ticket_number || '');
            if (!tn) return false;
            if (isTestEnv && tn.startsWith('TEST-')) return false;
            if (dStart && dEnd) {
              const d = parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime);
              if (d && (d < dStart || d > dEnd)) return false;
            }
            return true;
          });
          await dualWriteToReportsTickets(canonical, realTickets, { start: pStart, end: pEnd, jobId });
        }
      } catch (e) {
        console.error('[upload-worker] dual-write failed:', e.message);
      }

      await queueService.completeJob(jobId, {
        resultUrl: `/api/dashboard?jobId=${jobId}`,
        downloadUrl: `/api/ppt/download/${jobId}`,
      });

      await queueService.cleanupStagedFiles(jobId);
    });
  } catch (err) {
    console.error(`[upload-worker] Job ${jobId} failed:`, err);
    await queueService.failJob(jobId, err);
    historyService.recordReport({
      jobId,
      clientId,
      clientName,
      location: jobData.location || 'All Locations',
      reportPeriod: jobData.historyPeriodLabel || jobData.reportingPeriod,
      uploadedBy: jobData.uploadedBy || 'System User',
      status: 'failed',
      error: queueService.sanitizeErrorMessage(err),
    });
    await queueService.cleanupStagedFiles(jobId);
  } finally {
    unlock();
  }
});

/**
 * validateDateRange — Server-side date validation for report generation requests.
 * Enforces all four rules from Requirement 2:
 *   1. Both start_date and end_date are required.
 *   2. Neither date may be in the future (relative to today UTC).
 *   3. start_date must be on or before end_date.
 *   4. Dates must be valid ISO YYYY-MM-DD strings.
 *
 * Returns: { valid: true } | { valid: false, errors: string[] }
 */
function validateDateRange(startDate, endDate) {
  const errors = [];

  if (!startDate || typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
    errors.push('Start date is required and must be in YYYY-MM-DD format (e.g. 2026-01-15).');
  }
  if (!endDate || typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
    errors.push('End date is required and must be in YYYY-MM-DD format (e.g. 2026-07-31).');
  }

  if (errors.length > 0) return { valid: false, errors };

  const sd = new Date(startDate.trim() + 'T00:00:00Z');
  const ed = new Date(endDate.trim() + 'T23:59:59Z');

  if (isNaN(sd.getTime())) {
    errors.push(`Invalid start date: "${startDate}". Please provide a valid calendar date.`);
  }
  if (isNaN(ed.getTime())) {
    errors.push(`Invalid end date: "${endDate}". Please provide a valid calendar date.`);
  }

  if (errors.length > 0) return { valid: false, errors };

  // Rule: No future dates
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  if (sd > todayEnd) {
    errors.push(`Start date "${startDate}" is in the future. Report dates must be on or before today.`);
  }
  if (ed > todayEnd) {
    errors.push(`End date "${endDate}" is in the future. Report dates must be on or before today.`);
  }

  // Rule: start_date <= end_date
  if (sd > ed) {
    errors.push(`Start date "${startDate}" must be on or before end date "${endDate}".`);
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

// Vercel Serverless Path Normalizer: ONLY active on Vercel deployments.
// Ensures /api prefix is preserved when Vercel strips it in function rewrites.
if (process.env.VERCEL) {
  app.use((req, res, next) => {
    if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/assets') && !req.url.includes('.')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
    next();
  });
}

// Frontend static assets are served later (after API routes) with existence check.
// Removed duplicate early static registrations that pre-empted API routes on some paths.

// Helper to resolve data paths robustly whether running from project root or backend/ folder
function resolveDataPath(...subpaths) {
  const p1 = subpaths.length ? path.resolve(__dirname, '..', 'data', ...subpaths) : path.resolve(__dirname, '..', 'data');
  if (fs.existsSync(p1)) return p1;
  const p2 = subpaths.length ? path.resolve('data', ...subpaths) : path.resolve('data');
  if (fs.existsSync(p2)) return p2;
  const dir1 = path.resolve(__dirname, '..', 'data');
  if (fs.existsSync(dir1)) return p1;
  return p1;
}

// Directories (os.tmpdir fallback for Vercel serverless environment, PERSISTENT_DIR for cloud persistent storage)
const BASE_STORAGE_DIR = process.env.PERSISTENT_DIR || process.env.STORAGE_DIR || process.env.RENDER_DISK_PATH;
const INCOMING_DIR = BASE_STORAGE_DIR
  ? path.join(BASE_STORAGE_DIR, 'data', 'incoming')
  : (process.env.VERCEL ? path.join(os.tmpdir(), 'incoming') : resolveDataPath('incoming'));
const REPORTS_DIR = BASE_STORAGE_DIR
  ? path.join(BASE_STORAGE_DIR, 'reports')
  : (process.env.VERCEL ? path.join(os.tmpdir(), 'reports') : (fs.existsSync(path.resolve(__dirname, '..', 'reports')) ? path.resolve(__dirname, '..', 'reports') : path.resolve('reports')));

[INCOMING_DIR, REPORTS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Strict Zero Storage & Privacy Policy: Purge 1 (1).xlsx, 1.xlsx, 2.xlsx from project root
['1 (1).xlsx', '1.xlsx', '2.xlsx'].forEach((fname) => {
  const targets = [
    path.resolve(fname),
    path.join(__dirname, '..', fname),
  ];
  targets.forEach((target) => {
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
        console.log(`[server] Privacy Purge: Deleted root project file: ${path.basename(target)}`);
      } catch (e) { }
    }
  });
});

// In-memory active job cache shared across modules
const jobs = require('./services/jobCache');

// ── Canonical API v1 & Legacy Deprecation Router (Item #14) ──────────────────
const v1Router = require('./routes/v1Router');

function deprecationMiddleware(req, res, next) {
  if (req.path.startsWith('/v1') || req.originalUrl.startsWith('/api/v1')) {
    return next();
  }
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</api/v1${req.path}>; rel="successor-version"`);
  next();
}

app.use('/api/v1', v1Router);
app.use('/api', deprecationMiddleware, v1Router);

// ── JSON 404 Handler for API Routes (Before Static & SPA Fallback) ────────────
app.use(['/api', '/api/*'], (req, res) => {
  res.status(404).json({ error: 'API route not found', status: 404, path: req.originalUrl });
});

// ── Centralized JSON 500 Error Handler (Item #15 & Item #16 Sentry Deduplication) ─────
app.use((err, req, res, next) => {
  const reqId = req.id || req.headers['x-request-id'] || 'unknown';
  const status = err.status || err.statusCode || 500;

  // Single authoritative Sentry capture on unhandled 500 errors
  if (status >= 500) {
    sentry.captureException(err, { reqId, module: 'express', status });
  }

  if (req.log?.error) {
    req.log.error({ err, status, reqId }, err.message);
  } else {
    logger.error({ err, status, reqId }, err.message);
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : err.message,
    status,
    reqId,
  });
});

// ── Static Frontend Assets (Production / Render) ──────────────────────────────
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
const rootDistPath = path.join(__dirname, '..', 'dist');

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
} else if (fs.existsSync(rootDistPath)) {
  app.use(express.static(rootDistPath));
}

// ── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const idxFrontend = path.join(frontendDistPath, 'index.html');
  const idxRoot = path.join(rootDistPath, 'index.html');
  if (fs.existsSync(idxFrontend)) return res.sendFile(idxFrontend);
  if (fs.existsSync(idxRoot)) return res.sendFile(idxRoot);
  res.json({ message: 'Executive Dashboard & Multi-Client QBR Portal API running.' });
});

if ((require.main === module || !process.env.VERCEL) && process.env.NODE_ENV !== 'test') {
  // Validate JWT secret requirements on boot
  authService.assertJwtSecretValid();
  const DEFAULT_PORT = process.env.PORT || 3000;

  const startServer = (port) => {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.info({ port, reportsDir: REPORTS_DIR }, `[server] Multi-Client Web Portal running at http://localhost:${port}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn({ port }, `[server] Port ${port} occupied. Trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        logger.error({ err }, `[server] Startup error: ${err.message}`);
      }
    });
  };

  // ── Startup Cache Eviction Guard ─────────────────
  try {
    const canonicalPath = resolveDataPath('dashboard_data.json');
    if (fs.existsSync(canonicalPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
        const reportLabel = parsed?.report_period?.display_label || parsed?.reportingPeriod || '';
        
        if (reportLabel === 'User Selected Period' || reportLabel === 'Selected Period' || reportLabel === '') {
          logger.warn('[startup] Stale or placeholder dashboard_data.json detected. Evicting cache.');
          try { fs.unlinkSync(canonicalPath); } catch (_) {}
        } else {
          const n = parsed?.executiveSummary?.totalIncidents;
          logger.info(`[startup] Canonical dashboard_data.json present (${n ?? 'unknown'} incidents).`);
        }
      } catch (e) {
        logger.warn({ err: e }, `[startup] Canonical dashboard_data.json exists but is unreadable: ${e.message}`);
      }
    } else {
      logger.info('[startup] No canonical dashboard_data.json — empty state until first upload.');
    }
  } catch (err) {
    logger.warn({ err }, `[startup] Warning during startup cache validation: ${err.message}`);
  }

  historyService.cleanupOldReports(3);
  (async () => {
    try {
      const result = await migrate();
      logger.info({ statementsRun: result.statementsRun, durationMs: result.durationMs }, '[Phase G] Turso schema ready');
      const health = await healthCheck();
      if (!health.healthy) {
        throw new Error('Turso health check failed: ' + health.error);
      }
      logger.info('[Phase G] Turso connection healthy');
    } catch (err) {
      logger.error({ err }, `[Phase G] FATAL: migration/health failed: ${err.message}`);
      sentry.captureException(err, { module: 'startup', phase: 'migration' });
      process.exit(1);
    }
    startServer(Number(DEFAULT_PORT));
  })().catch((err) => {
    logger.error({ err }, '[Phase G] FATAL startup error');
    sentry.captureException(err, { module: 'startup', phase: 'serverListen' });
    process.exit(1);
  });

  // ── Task 3: Vulnerabilities Scheduler (node-cron) ──────────────────────
  try {
    const cron = require('node-cron');
    const { fetchAndSave, VULN_FILE } = require('./services/vulnerabilityFetcher');

    cron.schedule('0 */6 * * *', async () => {
      console.log('[vuln-fetch] Starting scheduled fetch...');
      try {
        await fetchAndSave();
        console.log('[vuln-fetch] Complete');
      } catch (err) {
        console.error('[vuln-fetch] Failed:', err.message);
      }
    });

    if (!fs.existsSync(VULN_FILE)) {
      fetchAndSave().catch(console.error);
    }
  } catch (cronErr) {
    console.warn('[server] Warning initializing vulnerability scheduler:', cronErr.message);
  }
}

module.exports = app;
