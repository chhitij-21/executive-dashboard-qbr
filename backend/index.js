// backend/index.js — Executive Report Dashboard API
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
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

const app = express();

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
    } catch (e) {}

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
  const ed = new Date(endDate.trim()   + 'T23:59:59Z');

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

// Directories (os.tmpdir fallback for Vercel serverless environment, PERSISTENT_DIR for cloud persistent storage)
const BASE_STORAGE_DIR = process.env.PERSISTENT_DIR || process.env.STORAGE_DIR || process.env.RENDER_DISK_PATH;
const INCOMING_DIR = BASE_STORAGE_DIR
  ? path.join(BASE_STORAGE_DIR, 'data', 'incoming')
  : (process.env.VERCEL ? path.join(os.tmpdir(), 'incoming') : path.resolve('data', 'incoming'));
const REPORTS_DIR = BASE_STORAGE_DIR
  ? path.join(BASE_STORAGE_DIR, 'reports')
  : (process.env.VERCEL ? path.join(os.tmpdir(), 'reports') : path.resolve('reports'));

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
      } catch (e) {}
    }
  });
});

// Temp file uploader with os.tmpdir fallback for Vercel serverless
const tempUploadDir = process.env.VERCEL ? os.tmpdir() : INCOMING_DIR;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    cb(null, `${uuidv4()}_${Date.now()}${ext}`);
  }
});

// ── MIME-type allowlist + 50 MB file size cap ─────────────────────────────
const ALLOWED_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
  'text/csv',                                                           // .csv
  'application/octet-stream',                                           // generic binary (some OS use this)
];
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext) || ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error(`File type not allowed: ${file.originalname}. Only .xlsx, .xls, .csv are accepted.`));
  },
});

// In-memory active job cache
const jobs = {};

const { handleAutoAuthRoute, requireAuth, requireAdmin } = require('./middleware/auth');

// ── Cache-Control: no-store on all /api responses ─────────────────────────
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ── Auth Routes ─────────────────────────────────────────────────────────────
app.get(['/api/auth/auto', '/auth/auto'], handleAutoAuthRoute);

app.post(['/api/auth/login', '/auth/login'], authRateLimit, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const session = authService.authenticateUser(email.trim(), password);
  if (!session) return res.status(401).json({ error: 'Invalid email or password' });
  res.json(session);
});

app.get(['/api/auth/me', '/auth/me'], requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post(['/api/auth/logout', '/auth/logout'], (req, res) => {
  authService.invalidateToken(req.headers.authorization);
  res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/auth/demo-accounts', (req, res) => {
  res.json({ users: authService.getDemoUsers() });
});

// SECURITY FIX (FINDING-019): Added requireAuth to prevent unauthenticated client enumeration.
app.get(['/api/clients', '/clients'], requireAuth, (req, res) => {
  res.json({ clients: clientService.getAllClients() });
});

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const client = clientService.getClientById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

app.post(['/api/clients', '/clients'], requireAuth, requireAdmin, (req, res) => {
  try {
    const newClient = clientService.createClient(req.body);
    res.status(201).json({ client: newClient });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put(['/api/clients/:id', '/clients/:id'], requireAuth, requireAdmin, (req, res) => {
  const updated = clientService.updateClient(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

app.post(['/api/clients/:id/locations', '/clients/:id/locations'], requireAuth, requireAdmin, (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: 'Location name is required' });
  const updated = clientService.addLocation(req.params.id, location);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

// ── Rules Configuration Endpoints ───────────────────────────────────────────
app.get(['/api/rules', '/rules'], (req, res) => {
  try {
    const rawYaml = ruleEngine.getRulesYaml();
    const parsed = ruleEngine.getRules();
    res.json({ yaml: rawYaml, rules: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put(['/api/rules', '/rules'], requireAuth, requireAdmin, (req, res) => {
  try {
    const { yaml: rawYaml } = req.body;
    if (!rawYaml || typeof rawYaml !== 'string') {
      return res.status(400).json({ error: 'YAML content is required.' });
    }
    // SECURITY FIX (FINDING-031): Limit YAML payload size to prevent DoS
    if (rawYaml.length > 50 * 1024) {
      return res.status(413).json({ error: 'YAML content too large. Maximum size is 50KB.' });
    }
    const result = ruleEngine.saveRulesYaml(rawYaml);
    res.json({ success: true, message: 'rules.yaml updated successfully', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid YAML format' });
  }
});

// SECURITY FIX (FINDING-019): Added requireAuth to prevent unauthenticated history enumeration.
app.get(['/api/history', '/history'], requireAuth, (req, res) => {
  const { clientId, location, status } = req.query;
  const history = historyService.getHistory({ clientId, location, status });
  res.json({ history });
});

app.delete(['/api/history', '/history'], requireAuth, requireAdmin, (req, res) => {
  try {
    console.log('[server] DELETE request received to clear ALL report history.');
    historyService.clearAllHistory();
    Object.keys(jobs).forEach((k) => delete jobs[k]);
    res.json({ success: true, message: 'All report history cleared successfully' });
  } catch (err) {
    console.error('[server] Error in DELETE /api/history:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.delete(['/api/history/:jobId', '/history/:jobId'], requireAuth, (req, res) => {
  try {
    const { jobId } = req.params;
    console.log(`[server] DELETE request received for report jobId: ${jobId}`);
    const deleted = historyService.deleteReport(jobId);
    if (jobs[jobId]) delete jobs[jobId];
    if (!deleted) return res.status(404).json({ error: 'Report not found or already deleted' });
    res.json({ success: true, message: 'Report deleted successfully', jobId });
  } catch (err) {
    console.error('[server] Error in DELETE /api/history/:jobId:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── Health Route ─────────────────────────────────────────────────────────────
app.get(['/api/health', '/health'], (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── AI Excel Schema Analyzer Endpoint ──────────────────────────────────────
app.post(['/api/analyze-excel', '/analyze-excel'], requireAuth, heavyRateLimit, upload.any(), (req, res) => {
  try {
    const uploadedFile = req.files?.[0] || req.file;
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No Excel or CSV file provided for AI analysis.' });
    }
    const filePath = uploadedFile.path;
    const { analyzeWorkbookSchema } = require('./services/excelParser');
    const analysis = analyzeWorkbookSchema(filePath);

    setTimeout(() => {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    }, 2000);

    res.json({ success: true, ...analysis });
  } catch (err) {
    console.error('[server] Error in /api/analyze-excel:', err.message);
    res.status(500).json({ error: `AI Excel Analysis failed: ${err.message}` });
  }
});

// ── Upload & Report Generation Workflow Endpoint ────────────────────────────
app.post(['/api/upload', '/upload'], requireAuth, heavyRateLimit, upload.fields([
  { name: 'incidents', maxCount: 1 },
  { name: 'inventory', maxCount: 1 },
  { name: 'excel', maxCount: 1 }, // legacy fallback
]), async (req, res) => {
  const incidentFile = req.files?.incidents?.[0] || req.files?.excel?.[0] || null;
  const inventoryFile = req.files?.inventory?.[0] || null;

  const clientId    = req.body.clientId   || 'client-jfl';
  const location    = req.body.location   || 'All Locations';
  const uploadedBy  = req.body.uploadedBy || 'System User';

  // Requirement 2: Accept start_date / end_date (custom date range only)
  // Legacy periodMode/reportPeriod are kept as fallback for /api/switch-mode internal backward compat.
  const startDate   = (req.body.start_date   || '').trim();
  const endDate     = (req.body.end_date     || '').trim();
  const periodMode  = req.body.periodMode   || 'custom'; // legacy; not used by UI anymore
  const reportPeriod = req.body.reportPeriod || req.body.reportingPeriod || '';

  // Server-side date validation (Requirement 2 — enforced independently of frontend)
  const dateValidation = validateDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    return res.status(400).json({
      error: 'Invalid date range',
      validationErrors: dateValidation.errors,
    });
  }

  const client     = clientService.getClientById(clientId);
  const clientName = client ? client.name : 'Executive Client';

  if (!incidentFile) {
    return res.status(400).json({ error: 'No mandatory Incidents file uploaded.' });
  }

  // 1. Upload Validation Layer (Pre-ingestion validation check)
  const validation = validateUpload(incidentFile, inventoryFile);
  if (!validation.valid) {
    // Delete temp uploaded files immediately on validation failure
    historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);
    return res.status(400).json({
      error: 'Pre-upload validation failed',
      validationErrors: validation.errors,
      validationWarnings: validation.warnings
    });
  }

  const jobId = uuidv4();
  const outputDir = path.join(REPORTS_DIR, `job_${jobId}`);

  // Human-readable period label for history records
  const historyPeriodLabel = startDate && endDate ? `${startDate} to ${endDate}` : (reportPeriod || 'Custom Period');

  // 2. Record initial metadata history (Status: Processing)
  const initialMeta = historyService.recordReport({
    jobId,
    clientId,
    clientName,
    location,
    reportPeriod: historyPeriodLabel,
    uploadedBy,
    status: 'processing',
  });

  jobs[jobId] = {
    status: 'processing',
    startedAt: new Date().toISOString(),
    outputDir,
    metadata: initialMeta
  };

  // 3. Trigger Existing Processing Engine asynchronously via setImmediate
  // Ensures res.json() flushes HTTP 200 to client/proxy BEFORE heavy background processing starts.
  setImmediate(() => {
    processJFLWorkbooks(incidentFile.path, inventoryFile ? inventoryFile.path : null, outputDir, {
      clientId,
      clientName,
      ruleConfigFile: client?.ruleConfigFile,
      // Requirement 2: Pass custom date range to engine (primary)
      startDate,
      endDate,
      // Legacy fields kept for backward compat with internal switch-mode
      reportingPeriod: reportPeriod || historyPeriodLabel,
      periodMode,
    })
      .then((result) => {
        const isSuccess = result && result.success;
        const status = isSuccess ? 'completed' : 'failed';

        const dashboardPath = result?.dashboardPath || path.join(outputDir, 'dashboard_data.json');
        const pptPath = result?.pptPath || path.join(outputDir, 'QBR_Presentation.pptx');
        const reportPath = result?.reportPath || path.join(outputDir, 'validation_report.md');
        const dataQualityPath = result?.dataQualityPath || path.join(outputDir, 'data_quality_report.md');
        const processingLogPath = result?.processingLogPath || path.join(outputDir, 'processing_log.md');

        const updatedJob = {
          status,
          ...result,
          dashboardPath: (dashboardPath && fs.existsSync(dashboardPath)) ? dashboardPath : null,
          pptPath: (pptPath && fs.existsSync(pptPath)) ? pptPath : null,
          reportPath: (reportPath && fs.existsSync(reportPath)) ? reportPath : null,
          dataQualityPath: (dataQualityPath && fs.existsSync(dataQualityPath)) ? dataQualityPath : null,
          processingLogPath: (processingLogPath && fs.existsSync(processingLogPath)) ? processingLogPath : null,
        };

        jobs[jobId] = updatedJob;

        // Update persistent metadata history
        historyService.recordReport({
          jobId,
          clientId,
          clientName,
          location,
          reportPeriod: historyPeriodLabel,
          uploadedBy,
          status,
          dashboardPath: updatedJob.dashboardPath,
          pptPath: updatedJob.pptPath,
          reportPath: updatedJob.reportPath,
          dataQualityPath: updatedJob.dataQualityPath,
          processingLogPath: updatedJob.processingLogPath,
          error: result?.error || null,
        });
      })
      .catch((err) => {
        console.error('[index] Engine error:', err.message);
        jobs[jobId] = { status: 'error', error: err.message };
        historyService.recordReport({
          jobId,
          clientId,
          clientName,
          location,
          reportPeriod,
          uploadedBy,
          status: 'error',
          error: err.message,
        });
      })
      .finally(() => {
        // 4. PRIVACY ENFORCEMENT: Delete raw Excel upload files post-processing
        historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);
      });
  });

  res.json({ jobId, status: 'processing', metadata: initialMeta });
});

// ── Dashboard JSON Endpoint ────────────────────────────────────────────────
app.get(['/api/dashboard/:jobId', '/dashboard/:jobId', '/api/dashboard', '/dashboard'], async (req, res) => {
  const reqJobId = req.params.jobId || req.query.jobId || 'latest';
  const siteFilter = req.query.site || req.query.location || 'ALL';
  let job = null;

  if (reqJobId === 'latest' || reqJobId === 'default') {
    const history = historyService.getHistory(); // history is sorted newest-first
    job = history.find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
  } else {
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
  }

  if (job && job.status === 'processing') {
    return res.status(202).json({ status: 'processing', message: 'Report is generating...' });
  }

  let dPath = job?.dashboardPath;
  if (!dPath || !fs.existsSync(dPath)) {
    const activeJobId = job?.jobId || reqJobId;
    const candidates = [
      path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json'),
      path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard.json'),
      path.resolve('data', 'bundled_default', 'dashboard_data.json'),
      path.resolve('data', 'dashboard_data.json'),
    ];
    dPath = candidates.find((p) => fs.existsSync(p));
  }

  // If no dashboard JSON is found from previous jobs, attempt auto-processing candidate Excel files in workspace root
  if (!dPath || !fs.existsSync(dPath)) {
    const incCandidates = [
      path.resolve('1 (1).xlsx'),
      path.resolve('1.xlsx'),
      path.join(__dirname, '..', '1 (1).xlsx'),
      path.join(__dirname, '..', '1.xlsx'),
      path.join(__dirname, '..', '..', 'New folder', '1 (1).xlsx'),
      path.join(__dirname, '..', '..', 'New folder', '1.xlsx'),
      path.resolve('SLA_Compliance_Report.csv'),
      path.resolve('jfl incidents.xlsx'),
      path.join(__dirname, '..', 'jfl incidents.xlsx'),
      path.join(__dirname, '..', '..', 'New folder', 'jfl incidents.xlsx'),
    ];
    const invCandidates = [
      path.resolve('2.xlsx'),
      path.join(__dirname, '..', '2.xlsx'),
      path.join(__dirname, '..', '..', 'New folder', '2.xlsx'),
      path.resolve('JFL Updated Inventory.xlsx'),
      path.join(__dirname, '..', 'JFL Updated Inventory.xlsx'),
      path.join(__dirname, '..', '..', 'New folder', 'JFL Updated Inventory.xlsx'),
    ];

    const incPath = incCandidates.find((p) => fs.existsSync(p));
    const invPath = invCandidates.find((p) => fs.existsSync(p));

    if (incPath) {
      try {
        console.log(`[server] Auto-processing candidate workbooks (${path.basename(incPath)}, ${invPath ? path.basename(invPath) : 'none'})...`);
        const autoJobId = 'auto-jfl-active';
        const outputDir = path.join(REPORTS_DIR, `job_${autoJobId}`);

        const result = await processJFLWorkbooks(incPath, invPath || null, outputDir);

        if (result && result.success && result.dashboardPath && fs.existsSync(result.dashboardPath)) {
          job = historyService.recordReport({
            jobId: autoJobId,
            clientId: 'client-jfl',
            clientName: 'Jubilant Foodworks Ltd (JFL)',
            location: 'All Locations',
            reportPeriod: result.qbrData?.report_period?.display_label || 'Active Dataset',
            uploadedBy: 'System Auto-Engine',
            status: 'completed',
            dashboardPath: result.dashboardPath,
            pptPath: result.pptPath,
            reportPath: result.reportPath,
            dataQualityPath: result.dataQualityPath,
            processingLogPath: result.processingLogPath,
          });
          jobs[autoJobId] = { status: 'completed', ...result, ...job };
          dPath = result.dashboardPath;
        }
      } catch (err) {
        console.error('[server] Error auto-processing candidate dataset:', err.message);
      }
    }
  }

  try {
    if (!dPath || !fs.existsSync(dPath)) return res.status(404).json({ error: 'Dashboard JSON not found' });
    const content = fs.readFileSync(dPath, 'utf8');
    const rawData = JSON.parse(content);
    const filteredData = filterDashboardBySite(rawData, siteFilter);
    res.json({ jobId: job?.jobId || reqJobId, ...filteredData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Period Mode Switch Endpoint (Monthly vs Quarterly) ──────────────────────
app.all(['/api/switch-mode', '/switch-mode'], async (req, res) => {
  try {
    const mode = (req.query.mode || req.body?.mode || 'monthly').toLowerCase();
    const periodMode = mode.includes('quarter') ? 'quarterly' : 'monthly';
    // NOTE: Do NOT hardcode a date label here — use a generic label so it never
    // overrides the user-selected date range from an upload. The actual reporting
    // period is always set by the user's start_date / end_date on upload.
    const reportingPeriod = periodMode === 'monthly' ? 'Monthly Report' : 'Quarterly Report (Q1 FY2026)';

    console.log(`[server] Switch period mode request received: ${periodMode}`);

    const incCandidates = [
      periodMode === 'monthly' ? path.resolve('../JLF MONTHLY REPORT - 1 JULY to 31 JULY 2026.xlsx') : null,
      path.resolve('SLA_Compliance_Report.xlsx'),
      path.resolve('../SLA_Compliance_Report.xlsx'),
      path.resolve('../JLF MONTHLY REPORT - 1 JULY to 31 JULY 2026.xlsx'),
      path.resolve('jfl incidents.xlsx'),
    ].filter(Boolean);

    const invCandidates = [
      path.resolve('JFL Updated Inventory.xlsx'),
      path.resolve('../JFL Updated Inventory.xlsx'),
    ];

    const incPath = incCandidates.find((p) => fs.existsSync(p)) || path.resolve('SLA_Compliance_Report.xlsx');
    const invPath = invCandidates.find((p) => fs.existsSync(p)) || path.resolve('JFL Updated Inventory.xlsx');

    const autoJobId = `jfl-${periodMode}-active`;
    const outputDir = path.join(REPORTS_DIR, `job_${autoJobId}`);

    const result = await processJFLWorkbooks(incPath, invPath, outputDir, { periodMode, reportingPeriod });

    if (result && result.success) {
      const record = historyService.recordReport({
        jobId: autoJobId,
        clientId: 'client-jfl',
        clientName: 'Jubilant Foodworks Ltd (JFL)',
        location: 'All Locations',
        reportPeriod: reportingPeriod,
        uploadedBy: 'User Mode Switch',
        status: 'completed',
        dashboardPath: result.dashboardPath,
        pptPath: result.pptPath,
        reportPath: result.reportPath,
        dataQualityPath: result.dataQualityPath,
        processingLogPath: result.processingLogPath,
      });

      jobs[autoJobId] = { status: 'completed', ...result, ...record };

      const content = fs.readFileSync(result.dashboardPath, 'utf8');
      const rawData = JSON.parse(content);
      const site = req.query.site || req.body?.site;
      const finalData = site ? filterDashboardBySite(rawData, site) : rawData;
      return res.json({ jobId: autoJobId, ...finalData });
    }

    res.status(500).json({ error: 'Failed to process report mode' });
  } catch (err) {
    console.error('[server] Error in /api/switch-mode:', err.message);
    res.status(500).json({ error: err.message });
  }
});




// ── Download Helpers ─────────────────────────────────────────────────────────
//
// SSOT GUARANTEE: The PPT served on download must ALWAYS match the dashboard.
// Strategy:
//   1. Try the job's pre-generated pptPath first (fast path).
//   2. If not found, regenerate from the job's own dashboard_data.json (correct data).
//   3. NEVER fall back to data/bundled_default PPT files — those contain stale demo data.
//
const sendFileHelper = (pathKey, defaultFilename) => async (req, res) => {
  try {
    const reqJobId = req.params.jobId;
    let job = null;

    if (reqJobId === 'latest' || reqJobId === 'default') {
      const history = historyService.getHistory(); // history is sorted newest-first
      job = history.find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    }

    // Auto-generate default dataset if no job exists at all
    if (!job) {
      const incCandidates = [
        path.resolve('1 (1).xlsx'),
        path.resolve('1.xlsx'),
        path.join(__dirname, '..', '1 (1).xlsx'),
        path.join(__dirname, '..', '1.xlsx'),
        path.join(__dirname, '..', '..', 'New folder', '1 (1).xlsx'),
        path.join(__dirname, '..', '..', 'New folder', '1.xlsx'),
        path.resolve('SLA_Compliance_Report.csv'),
        path.resolve('jfl incidents.xlsx'),
        path.join(__dirname, '..', 'jfl incidents.xlsx'),
      ];
      const invCandidates = [
        path.resolve('2.xlsx'),
        path.join(__dirname, '..', '2.xlsx'),
        path.join(__dirname, '..', '..', 'New folder', '2.xlsx'),
        path.resolve('JFL Updated Inventory.xlsx'),
        path.join(__dirname, '..', 'JFL Updated Inventory.xlsx'),
      ];

      const incPath = incCandidates.find((p) => fs.existsSync(p));
      const invPath = invCandidates.find((p) => fs.existsSync(p));

      if (incPath) {
        console.log(`[server] Auto-processing sample dataset for download request (${path.basename(incPath)})...`);
        const autoJobId = 'master-jfl-q1-fy2026';
        const outputDir = path.join(REPORTS_DIR, `job_${autoJobId}`);

        const result = await processJFLWorkbooks(
          incPath,
          invPath || null,
          outputDir
        );

        if (result && result.success) {
          job = historyService.recordReport({
            jobId: autoJobId,
            clientId: 'client-jfl',
            clientName: 'Jubilant Foodworks Ltd (JFL)',
            location: 'All Locations',
            reportPeriod: 'Q1 FY2026',
            uploadedBy: 'System Auto-Engine',
            status: 'completed',
            dashboardPath: result.dashboardPath,
            pptPath: result.pptPath,
            reportPath: result.reportPath,
            dataQualityPath: result.dataQualityPath,
            processingLogPath: result.processingLogPath,
          });
          jobs[autoJobId] = { status: 'completed', ...result, ...job };
        }
      }
    }

    if (!job) return res.status(404).json({ error: 'Report job not found' });

    // ── PPT: Always generate fresh PPT on-the-fly from dashboard_data.json (SSOT guarantee) ────
    if (pathKey === 'pptPath') {
      const activeJobId = job?.jobId || reqJobId;
      const jobOutputDir = path.join(REPORTS_DIR, `job_${activeJobId}`);
      const dashCandidates = [
        job?.dashboardPath,
        path.join(jobOutputDir, 'dashboard_data.json'),
        path.resolve('data', 'dashboard_data.json'),
        path.resolve('data', 'bundled_default', 'dashboard_data.json'),
      ].filter(Boolean);

      const dashPath = dashCandidates.find((p) => p && fs.existsSync(p));

      if (dashPath) {
        try {
          console.log(`[server] Regenerating fresh PPT on-the-fly from SSOT: ${dashPath}`);
          if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });
          const freshPptPath = path.join(jobOutputDir, `JFL_QBR_${Date.now()}.pptx`);
          const qbrData = JSON.parse(fs.readFileSync(dashPath, 'utf8'));
          await generatePPT(qbrData, null, freshPptPath);

          // Update job record with fresh PPT path
          job.pptPath = freshPptPath;
          jobs[activeJobId] = { ...jobs[activeJobId], pptPath: freshPptPath };
          historyService.recordReport({
            ...job,
            jobId: activeJobId,
            status: 'completed',
            pptPath: freshPptPath,
          });

          console.log(`[server] Fresh PPT generated & served: ${freshPptPath}`);
          targetPath = freshPptPath;
        } catch (genErr) {
          console.error('[server] On-the-fly PPT generation failed:', genErr.message);
          return res.status(500).json({ error: `PPT generation failed: ${genErr.message}` });
        }
      } else {
        return res.status(404).json({ error: 'Dashboard data not found for PPT generation. Please re-upload your files.' });
      }
    }

      // Security path traversal guard
      const resolvedTarget = path.resolve(targetPath);
      const resolvedReports = path.resolve(REPORTS_DIR);
      const resolvedData    = path.resolve(__dirname, '..', 'data');
      const isUnderReports  = resolvedTarget.startsWith(resolvedReports + path.sep) || resolvedTarget === resolvedReports;
      const isUnderData     = resolvedTarget.startsWith(resolvedData    + path.sep) || resolvedTarget === resolvedData;

      if (!isUnderReports && !isUnderData) {
        console.error(`[server] SECURITY: Path traversal attempt blocked. Requested: ${resolvedTarget}`);
        return res.status(403).json({ error: 'Access denied.' });
      }

      console.log(`[server] Serving PPT download: ${resolvedTarget}`);
      return res.download(resolvedTarget);
    }

    // ── Non-PPT files: existing logic (reports, logs, etc.) ──────────────────
    let targetPath = job?.[pathKey];
    if (!targetPath || !fs.existsSync(targetPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const candidates = [
        path.join(REPORTS_DIR, `job_${activeJobId}`, defaultFilename),
        path.resolve('data', 'bundled_default', defaultFilename),
        path.resolve('data', defaultFilename),
      ];
      targetPath = candidates.find((p) => fs.existsSync(p));
    }

    // Search directory for matching file extension if targetPath not directly found
    if (!targetPath || !fs.existsSync(targetPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const dirsToSearch = [
        activeJobId ? path.join(REPORTS_DIR, `job_${activeJobId}`) : null,
        path.resolve('data', 'bundled_default'),
        path.resolve('data'),
      ].filter(Boolean);

      for (const d of dirsToSearch) {
        if (fs.existsSync(d)) {
          const files = fs.readdirSync(d);
          const match = files.find(f => f.toLowerCase().endsWith('.md') && pathKey === 'reportPath');
          if (match) {
            targetPath = path.join(d, match);
            break;
          }
        }
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: `${pathKey} file not available on server` });
    }

    // SECURITY FIX (FINDING-007): Path traversal guard.
    const resolvedTarget = path.resolve(targetPath);
    const resolvedReports = path.resolve(REPORTS_DIR);
    const resolvedData = path.resolve(__dirname, '..', 'data');
    const isUnderReports = resolvedTarget.startsWith(resolvedReports + path.sep) || resolvedTarget === resolvedReports;
    const isUnderData = resolvedTarget.startsWith(resolvedData + path.sep) || resolvedTarget === resolvedData;

    if (!isUnderReports && !isUnderData) {
      console.error(`[server] SECURITY: Path traversal attempt blocked. Requested: ${resolvedTarget}`);
      return res.status(403).json({ error: 'Access denied.' });
    }

    console.log(`[server] Serving file download: ${resolvedTarget}`);
    res.download(resolvedTarget);
  } catch (err) {
    console.error('[server] Download error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

app.get(['/api/ppt/:jobId', '/ppt/:jobId'], sendFileHelper('pptPath', 'JFL_QBR_Report.pptx'));
app.get(['/api/report/:jobId', '/report/:jobId'], sendFileHelper('reportPath', 'validation_report.md'));
app.get(['/api/error-report/:jobId', '/error-report/:jobId'], sendFileHelper('errorReportPath', 'error_report.json'));
app.get(['/api/data-quality/:jobId', '/data-quality/:jobId'], sendFileHelper('dataQualityPath', 'data_quality_report.md'));
app.get(['/api/processing-log/:jobId', '/processing-log/:jobId'], sendFileHelper('processingLogPath', 'processing_log.md'));

// ── Job Status Route ────────────────────────────────────────────────────────
app.get(['/api/status/:jobId', '/status/:jobId'], (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId, ...job });
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

if (require.main === module || !process.env.VERCEL) {
  const DEFAULT_PORT = process.env.PORT || 3000;

  const startServer = (port) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[server] Multi-Client Web Portal running at http://localhost:${port}`);
      console.log(`[server] Reports directory: ${REPORTS_DIR}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[server] Port ${port} occupied. Trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('[server] Startup error:', err.message);
      }
    });
  };

  startServer(Number(DEFAULT_PORT));
}

module.exports = app;
