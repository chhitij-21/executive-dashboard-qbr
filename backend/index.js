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
const { generatePDF } = require('./services/pdfGenerator');

const clientService = require('./services/clientService');
const historyService = require('./services/historyService');
const { validateUpload } = require('./services/uploadValidationService');
const authService = require('./services/authService');
const ruleEngine = require('./services/ruleEngine');
const { migrate } = require('./db/migrate');
const { healthCheck } = require('./config/database');

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
require('./routes/validationRoutes').mount(app);
app.use('/api/vulnerabilities', require('./routes/vulnerabilities'));
app.use(['/api/mfa', '/mfa'], require('./routes/mfa'));
const inventorySyncRouter = require('./routes/inventorySync');
app.use('/api/inventory', inventorySyncRouter);
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

const { handleAutoAuthRoute, requireAuth, requireAdmin, requireClientAccess } = require('./middleware/auth');

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
  const result = authService.authenticateUser(email.trim(), password);
  if (!result) return res.status(401).json({ error: 'Invalid email or password' });
  if (result.mfaRequired) {
    return res.json({
      mfaRequired: true,
      tempToken: result.tempToken,
      user: result.user,
    });
  }
  res.json(result);
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

// ── Single-Use Short-Lived Download Ticket Issuance (60-second TTL) ───────────
app.post(['/api/auth/download-ticket', '/auth/download-ticket'], requireAuth, (req, res) => {
  const { clientId, jobId, exportType } = req.body || {};
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
  }

  const trimmedClientId = clientId.trim();
  const canonicalClientId = clientService.resolveCanonicalClientId(trimmedClientId);
  const client = clientService.getClientById(canonicalClientId);
  if (!client) {
    return res.status(404).json({ error: `Unknown customer '${trimmedClientId}'.`, code: 'UNKNOWN_CLIENT' });
  }

  // FAIL-CLOSED Role & Tenant Authorization Check
  if (!req.user || !req.user.role || !req.user.assignedClient) {
    return res.status(403).json({ error: 'Invalid authenticated profile.', code: 'ACCESS_DENIED' });
  }

  if (req.user.role !== 'admin') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
    if (canonicalAssigned !== canonicalClientId) {
      return res.status(403).json({
        error: `Forbidden: You are not authorized to access customer '${client.name || trimmedClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  // Job ownership verification if jobId provided
  if (jobId && jobId !== 'latest' && jobId !== 'default') {
    const job = jobs[jobId] || historyService.getReportByJobId(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job '${jobId}' not found.`, code: 'JOB_NOT_FOUND' });
    }
    if (job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== canonicalClientId) {
      return res.status(403).json({
        error: `Customer isolation violation: Job '${jobId}' belongs to another customer.`,
        code: 'CUSTOMER_ISOLATION_VIOLATION',
      });
    }
  }

  const ticketData = authService.createDownloadTicket({
    user: req.user,
    userId: req.user.id,
    clientId: canonicalClientId,
    jobId: jobId || 'latest',
    exportType: exportType || 'export',
  });

  res.json({
    downloadTicket: ticketData.ticket,
    expiresIn: ticketData.expiresIn,
    clientId: canonicalClientId,
  });
});

// ── Single-Use Short-Lived SSE Ticket Issuance (60-second TTL) ────────────────
app.post(['/api/auth/sse-ticket', '/auth/sse-ticket'], requireAuth, (req, res) => {
  const { clientId } = req.body || {};
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
  }

  const trimmedClientId = clientId.trim();
  const canonicalClientId = clientService.resolveCanonicalClientId(trimmedClientId);
  const client = clientService.getClientById(canonicalClientId);
  if (!client) {
    return res.status(404).json({ error: `Unknown customer '${trimmedClientId}'.`, code: 'UNKNOWN_CLIENT' });
  }

  // FAIL-CLOSED Role & Tenant Authorization Check
  if (!req.user || !req.user.role || !req.user.assignedClient) {
    return res.status(403).json({ error: 'Invalid authenticated profile.', code: 'ACCESS_DENIED' });
  }

  if (req.user.role !== 'admin') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
    if (canonicalAssigned !== canonicalClientId) {
      return res.status(403).json({
        error: `Forbidden: You are not authorized to access customer '${client.name || trimmedClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  const ticketData = authService.createSSETicket({
    user: req.user,
    userId: req.user.id,
    clientId: canonicalClientId,
  });

  res.json({
    sseTicket: ticketData.sseTicket,
    expiresIn: ticketData.expiresIn,
    clientId: canonicalClientId,
  });
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

// SECURITY FIX: Enforce requireClientAccess on history to prevent cross-tenant enumeration
app.get(['/api/history', '/history'], requireAuth, requireClientAccess(), (req, res) => {
  const { location, status } = req.query;
  const history = historyService.getHistory({ clientId: req.targetClientId, location, status });
  res.json({ history, clientId: req.targetClientId });
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
    const report = historyService.getReportByJobId(jobId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found or already deleted', code: 'REPORT_NOT_FOUND' });
    }

    // Role-based tenant authorization check for deletion
    if (req.user.role !== 'admin') {
      const userAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
      const jobClient = clientService.resolveCanonicalClientId(report.clientId);
      if (userAssigned !== jobClient) {
        return res.status(403).json({
          error: "Forbidden: You are not authorized to delete another customer's report.",
          code: 'CUSTOMER_ACCESS_FORBIDDEN',
        });
      }
    }

    const deleted = historyService.deleteReport(jobId);
    if (jobs[jobId]) delete jobs[jobId];
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
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
    }, 2000);

    res.json({ success: true, ...analysis });
  } catch (err) {
    console.error('[server] Error in /api/analyze-excel:', err.message);
    res.status(500).json({ error: `AI Excel Analysis failed: ${err.message}` });
  }
});

/**
 * Safely resolves the latest completed job strictly belonging to the given customer.
 * Compares validated epoch timestamps and falls back to deterministic insertion order.
 */
function resolveLatestCompletedJob(clientId) {
  if (!clientId) return null;
  const inMemoryMatches = Object.values(jobs)
    .filter((j) => j && j.clientId === clientId && j.status === 'completed');
  const clientHistory = historyService.getHistory({ clientId, status: 'completed' });

  const allCandidates = [...inMemoryMatches, ...clientHistory];
  if (allCandidates.length === 0) return null;

  const uniqueMap = new Map();
  for (const c of allCandidates) {
    if (c.jobId && !uniqueMap.has(c.jobId)) {
      uniqueMap.set(c.jobId, c);
    }
  }

  const parseSafe = (ts) => {
    if (!ts) return null;
    const t = new Date(ts).getTime();
    return isNaN(t) ? null : t;
  };

  const sorted = Array.from(uniqueMap.values()).sort((a, b) => {
    const tb = parseSafe(b.uploadTimestamp);
    const ta = parseSafe(a.uploadTimestamp);
    if (tb !== null && ta !== null) return tb - ta;
    if (tb !== null) return 1;
    if (ta !== null) return -1;
    return 0;
  });

  return sorted[0] || null;
}

// ── Executive QBR AI Chatbot Assistant Endpoint ────────────────────────────
app.post(['/api/chat', '/chat'], requireAuth, requireClientAccess((req) => req.body?.clientId || req.query?.clientId || req.headers['x-client-id']), async (req, res) => {
  try {
    const { prompt, jobId } = req.body || {};
    const clientId = req.targetClientId;
    const client = req.targetClient;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt string is required.' });
    }

    // Resolve target job dataset scoped to client
    let job = null;
    const reqJobId = jobId || 'latest';
    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      job = resolveLatestCompletedJob(clientId);
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
      if (job && job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== clientId) {
        return res.status(403).json({
          error: `Customer isolation violation: Job '${reqJobId}' belongs to another customer.`,
          code: 'CUSTOMER_ISOLATION_VIOLATION',
        });
      }
    }

    let qbrData = null;
    let dPath = job?.dashboardPath;
    if (!dPath || !fs.existsSync(dPath)) {
      const activeJobId = job?.jobId || (reqJobId !== 'latest' && reqJobId !== 'default' ? reqJobId : null);
      if (activeJobId) {
        const candidate = path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json');
        if (fs.existsSync(candidate)) dPath = candidate;
      }
    }

    if (dPath && fs.existsSync(dPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(dPath, 'utf8'));
        if (!parsed.clientId || parsed.clientId === clientId) {
          qbrData = parsed;
        }
      } catch (e) { }
    }

    const { processChatQuery } = require('./services/aiChatService');
    const result = await processChatQuery(prompt, qbrData);
    res.json({ success: true, prompt, ...result });
  } catch (err) {
    console.error('[server] Error in /api/chat:', err.message);
    res.status(500).json({ error: `AI Chat processing error: ${err.message}` });
  }
});

function getCleanExecutiveSummary(section, qbrData) {
  const customer = qbrData.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const period = qbrData.report_period?.display_label || qbrData.reportingPeriod || 'Selected Period';
  const exec = qbrData.executiveSummary || {};
  const pro = qbrData.proactiveTicketAnalytics || {};

  const totalDevs = exec.totalDevices || (qbrData.devices ? qbrData.devices.filter(d => !d.__isStock).length : 0);
  const health = exec.healthScore || '100.00';
  const healthLabel = exec.healthLabel || (parseFloat(health) >= 90 ? 'Excellent' : parseFloat(health) >= 80 ? 'Good' : 'Fair');
  const slaRate = exec.slaCompliance || exec.slaComplianceRate || (pro.overall ? pro.overall.slaPercent : '100.00');
  const totalInc = exec.totalIncidents !== undefined ? exec.totalIncidents : (pro.overall ? pro.overall.total : (qbrData.incidents ? qbrData.incidents.length : 0));
  const switchUptime = exec.jflSwitchUptime || exec.overallUptime || '100.00';

  const switchRCA = exec.primaryRcaSwitches || exec.primaryRca || 'Stable Operations (No Incidents)';
  const apRCA = exec.primaryRcaAPs || exec.primaryRcaForAPs || 'Stable Operations (No Incidents)';

  const summaries = {
    executive: `During the ${period} reporting period, network operations for ${customer} maintained robust overall availability across all ${totalDevs} monitored network assets, achieving an Executive Health Score of **${health}/100 (${healthLabel})** and a **${slaRate}% SLA Compliance Rate** across ${totalInc} logged incidents. Overall switch availability averaged **${switchUptime}%**, with primary outage drivers attributed to ${switchRCA}. Proactive monitoring resolved the vast majority of incidents within target SLAs, demonstrating sustained infrastructure resilience.`,

    engineer: `Field engineering and NOC support teams demonstrated high operational efficiency during ${period}, resolving ${totalInc} incidents within established SLA thresholds (**${slaRate}% SLA Compliance**). Ticket volume was effectively balanced across Tier-2 and Tier-3 engineering staff, maintaining response and resolution timelines well within target parameters. High-priority incidents received immediate resolution, ensuring minimal business disruption.`,

    site: `Incident activity across store locations was concentrated primarily in high-density operational centers, driven chiefly by localized factors (${switchRCA}). Ongoing power stabilization and targeted infrastructure updates at high-volume sites will further strengthen location-wide uptime.`,

    holdReason: `The primary driver for ticket holds on switch infrastructure was identified as **${switchRCA}**, while Access Point holds were predominantly linked to **${apRCA}**. Zero tickets were delayed due to NOC inactivity.`
  };

  return summaries[section] || summaries.executive;
}

// ── AI Section Summary Endpoint ─────────────────────────────────────────────
app.post(['/api/ai/section-summary', '/ai/section-summary'], requireAuth, requireClientAccess((req) => req.body?.clientId || req.query?.clientId || req.headers['x-client-id']), async (req, res) => {
  try {
    const { section, jobId } = req.body || {};
    const clientId = req.targetClientId;
    const client = req.targetClient;
    const validSections = ['executive', 'engineer', 'site', 'holdReason'];
    if (!section || !validSections.includes(section)) {
      return res.status(400).json({ error: `Invalid section. Must be one of: ${validSections.join(', ')}` });
    }

    let job = null;
    const reqJobId = jobId || 'latest';
    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      job = resolveLatestCompletedJob(clientId);
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
      if (job && job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== clientId) {
        return res.status(403).json({
          error: `Customer isolation violation: Job '${reqJobId}' belongs to another customer.`,
          code: 'CUSTOMER_ISOLATION_VIOLATION',
        });
      }
    }

    let dPath = job?.dashboardPath;
    if (!dPath || !fs.existsSync(dPath)) {
      const activeJobId = job?.jobId || (reqJobId !== 'latest' && reqJobId !== 'default' ? reqJobId : null);
      if (activeJobId) {
        const candidate = path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json');
        if (fs.existsSync(candidate)) dPath = candidate;
      }
    }

    if (!dPath || !fs.existsSync(dPath)) {
      return res.status(404).json({ error: 'Dashboard dataset not found.' });
    }

    let qbrData = null;
    try {
      qbrData = JSON.parse(fs.readFileSync(dPath, 'utf8'));
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read dataset.' });
    }

    if (qbrData.clientId && qbrData.clientId !== clientId) {
      return res.status(403).json({ error: 'Customer isolation violation: Data artifact belongs to another customer.' });
    }

    const cachedSummary = qbrData.aiSectionSummaries?.[section];
    const isStaleRawText = cachedSummary && (cachedSummary.includes('$$') || cachedSummary.includes('Math.round') || cachedSummary.includes('- **Total Devices**'));

    if (cachedSummary && !isStaleRawText) {
      return res.json({
        success: true,
        section,
        summary: cachedSummary,
        cached: true,
      });
    }

    const summaryText = getCleanExecutiveSummary(section, qbrData);
    qbrData.aiSectionSummaries = qbrData.aiSectionSummaries || {};
    qbrData.aiSectionSummaries[section] = summaryText;

    try {
      fs.writeFileSync(dPath, JSON.stringify(qbrData, null, 2), 'utf8');
    } catch (writeErr) {
      console.warn('[server] Warning writing AI section summary cache:', writeErr.message);
    }

    res.json({
      success: true,
      section,
      summary: summaryText,
      cached: false,
    });
  } catch (err) {
    console.error('[server] Error in /api/ai/section-summary:', err.message);
    res.status(500).json({ error: `Section summary generation error: ${err.message}` });
  }
});

// ── Enterprise AI Insights Endpoint (Virtual CTO AI Engine) ────────────────
const { generateEnterpriseInsights } = require('./services/aiInsightsService');

app.post(['/api/ai/insights', '/ai/insights'], requireAuth, requireClientAccess((req) => req.body?.clientId || req.query?.clientId || req.headers['x-client-id'] || (req.user?.assignedClient !== 'all' ? req.user?.assignedClient : 'client-jfl')), async (req, res) => {
  try {
    const { section, data: bodyData, jobId } = req.body || {};
    const clientId = req.targetClientId;

    let targetData = bodyData;
    if (!targetData) {
      const reqJobId = jobId || 'latest';
      let job = null;
      if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
        job = resolveLatestCompletedJob(clientId);
      } else {
        job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
      }

      let dPath = job?.dashboardPath;
      if (!dPath || !fs.existsSync(dPath)) {
        const activeJobId = job?.jobId || (reqJobId !== 'latest' && reqJobId !== 'default' ? reqJobId : null);
        if (activeJobId) {
          const candidate = path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json');
          if (fs.existsSync(candidate)) dPath = candidate;
        }
      }

      if (dPath && fs.existsSync(dPath)) {
        try {
          targetData = JSON.parse(fs.readFileSync(dPath, 'utf8'));
        } catch (e) { }
      }
    }

    const insights = await generateEnterpriseInsights({
      section: section || 'overview',
      data: targetData,
      clientId,
    });

    res.json({
      success: true,
      section: section || 'overview',
      executive_summary: insights.executive_summary,
      business_risks: insights.business_risks,
      action_items: insights.action_items,
      ...insights,
      data: insights,
    });
  } catch (err) {
    console.error('[server] Error in /api/ai/insights:', err.message);
    res.status(500).json({ error: `AI Insights generation error: ${err.message}` });
  }
});

// ── Claudex Loop — Agentic SSE Endpoint ────────────────────────────────────
// GET /api/chat/loop?prompt=...&jobId=...&clientId=...&ticket=sse_...
// Streams Think->Act->Observe->Repeat events via Server-Sent Events.
// Requires single-use short-lived SSE ticket (?ticket=sse_...). Full session tokens in query strings are rejected.
app.get(['/api/chat/loop', '/chat/loop'], async (req, res) => {
  const ticket = req.query.ticket;
  let authUser = null;
  let authorizedClientId = null;

  if (ticket) {
    const ticketData = authService.verifyAndConsumeSSETicket(ticket);
    if (!ticketData) {
      return res.status(401).json({ error: 'Invalid or expired SSE ticket.', code: 'INVALID_SSE_TICKET' });
    }
    authUser = ticketData.user;
    authorizedClientId = ticketData.clientId;
  } else if (req.headers.authorization) {
    const session = authService.verifyToken(req.headers.authorization);
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Authorization required — please log in.', code: 'UNAUTHORIZED' });
    }
    authUser = session.user;
  } else {
    return res.status(401).json({ error: 'Authorization required — valid SSE ticket must be provided.', code: 'INVALID_SSE_TICKET' });
  }

  const rawClientId = String(req.query.clientId || req.headers['x-client-id'] || authorizedClientId || '').trim();
  if (!rawClientId) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
  }

  const canonicalClientId = clientService.resolveCanonicalClientId(rawClientId);
  const client = clientService.getClientById(canonicalClientId);
  if (!client) {
    return res.status(404).json({ error: `Unknown customer '${rawClientId}'.`, code: 'UNKNOWN_CLIENT' });
  }

  // Confirm ticket.clientId matches requested clientId
  if (authorizedClientId && authorizedClientId !== canonicalClientId) {
    return res.status(403).json({
      error: 'Forbidden: SSE ticket is not valid for requested customer.',
      code: 'CUSTOMER_ACCESS_FORBIDDEN',
    });
  }

  // FAIL-CLOSED Role & Tenant Authorization Check
  if (!authUser || !authUser.role || !authUser.assignedClient) {
    return res.status(403).json({ error: 'Invalid user role on authenticated profile.', code: 'INVALID_USER_ROLE' });
  }

  if (!['admin', 'client_user'].includes(authUser.role)) {
    return res.status(403).json({ error: 'Unrecognized user role on authenticated profile.', code: 'UNRECOGNIZED_USER_ROLE' });
  }

  if (authUser.role === 'client_user') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(authUser.assignedClient);
    if (!canonicalAssigned) {
      return res.status(403).json({ error: 'Unknown assigned customer on user profile.', code: 'UNKNOWN_ASSIGNED_CLIENT' });
    }
    if (canonicalAssigned !== canonicalClientId) {
      return res.status(403).json({
        error: `Forbidden: You are not authorized to access customer '${client.name || rawClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  req.user = authUser;
  req.targetClientId = canonicalClientId;
  req.targetClient = client;

  const prompt = req.query.prompt || '';
  const jobId = req.query.jobId || 'latest';
  const maxIter = parseInt(req.query.maxIterations, 10) || 4;

  if (!prompt.trim()) {
    return res.status(400).json({ error: 'prompt query parameter is required.' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Helper to emit an SSE event
  function emit(eventName, payload) {
    if (res.writableEnded) { return; }
    const data = JSON.stringify(payload);
    res.write(`event: ${eventName}\ndata: ${data}\n\n`);
  }

  const clientId = canonicalClientId;

  // Resolve QBR SSOT data scoped to customer
  let job = null;
  const reqJobId = jobId;
  if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
    job = resolveLatestCompletedJob(clientId);
  } else {
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    if (job && job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== clientId) {
      emit('error', {
        message: `Customer isolation violation: Job '${reqJobId}' belongs to another customer.`,
        code: 'CUSTOMER_ISOLATION_VIOLATION',
      });
      return res.end();
    }
  }

  let qbrData = null;
  let dPath = job && job.dashboardPath ? job.dashboardPath : null;
  if (!dPath || !fs.existsSync(dPath)) {
    const activeJobId = (job && job.jobId) ? job.jobId : (reqJobId !== 'latest' && reqJobId !== 'default' ? reqJobId : null);
    if (activeJobId) {
      const candidate = path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json');
      if (fs.existsSync(candidate)) dPath = candidate;
    }
  }
  if (dPath && fs.existsSync(dPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dPath, 'utf8'));
      if (!parsed.clientId || parsed.clientId === clientId) {
        qbrData = parsed;
      }
    } catch (e) { }
  }

  try {
    const { runClaudexLoop } = require('./services/claudexLoopService');
    await runClaudexLoop(prompt, qbrData, emit, { maxIterations: maxIter });
  } catch (err) {
    console.error('[server] Claudex Loop error:', err.message);
    emit('error', { message: 'Claudex Loop error: ' + err.message });
  } finally {
    if (!res.writableEnded) { res.end(); }
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

  const rawClientId = String(req.body.clientId || '').trim();
  if (!rawClientId) {
    historyService.cleanupTempFiles([incidentFile?.path, inventoryFile?.path]);
    return res.status(400).json({ error: 'Customer identifier (clientId) is required for report generation.' });
  }

  const client = clientService.getClientById(rawClientId);
  if (!client) {
    historyService.cleanupTempFiles([incidentFile?.path, inventoryFile?.path]);
    return res.status(404).json({ error: `Unknown customer identifier: "${rawClientId}". Upload rejected.`, code: 'UNKNOWN_CLIENT' });
  }

  // FAIL-CLOSED Role-based client authorization check
  if (req.user && req.user.role !== 'admin') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
    if (canonicalAssigned !== client.id) {
      historyService.cleanupTempFiles([incidentFile?.path, inventoryFile?.path]);
      return res.status(403).json({
        error: `Forbidden: You are not authorized to upload datasets for customer '${client.name || rawClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  const clientId = client.id;
  const clientName = client.name;
  const location = req.body.location || 'All Locations';
  const uploadedBy = req.body.uploadedBy || 'System User';

  // Requirement 2: Accept start_date / end_date (custom date range only)
  // Legacy periodMode/reportPeriod are kept as fallback for /api/switch-mode internal backward compat.
  const startDate = (req.body.start_date || '').trim();
  const endDate = (req.body.end_date || '').trim();
  const periodMode = req.body.periodMode || 'custom'; // legacy; not used by UI anymore
  const reportPeriod = req.body.reportPeriod || req.body.reportingPeriod || '';

  // Server-side date validation (Requirement 2 — enforced independently of frontend)
  const dateValidation = validateDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    historyService.cleanupTempFiles([incidentFile?.path, inventoryFile?.path]);
    return res.status(400).json({
      error: 'Invalid date range',
      validationErrors: dateValidation.errors,
    });
  }

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
    jobId,
    clientId,
    status: 'processing',
    startedAt: new Date().toISOString(),
    outputDir,
    metadata: initialMeta
  };

  try {
    const result = await processJFLWorkbooks(incidentFile.path, inventoryFile ? inventoryFile.path : null, outputDir, {
      clientId,
      clientName,
      ruleConfigFile: client?.ruleConfigFile,
      startDate,
      endDate,
      reportingPeriod: reportPeriod || historyPeriodLabel,
      periodMode,
    });

    const isSuccess = Boolean(result && result.success);

    if (!isSuccess) {
      const failError = result?.error || 'Report processing failed validation.';
      jobs[jobId] = {
        jobId,
        clientId,
        status: 'failed',
        error: failError,
        errorCode: result?.errorCode || 'processing_failed',
      };
      historyService.recordReport({
        jobId,
        clientId,
        clientName,
        location,
        reportPeriod: historyPeriodLabel,
        uploadedBy,
        status: 'failed',
        error: failError,
      });
      historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);
      return res.status(400).json({
        success: false,
        jobId,
        status: 'failed',
        error: failError,
        errorCode: result?.errorCode || 'processing_failed',
      });
    }

    const dashboardPath = result?.dashboardPath || path.join(outputDir, 'dashboard_data.json');
    const pptPath = result?.pptPath || path.join(outputDir, `${client.code || 'CLIENT'}_QBR_Report.pptx`);
    const reportPath = result?.reportPath || path.join(outputDir, 'validation_report.md');
    const dataQualityPath = result?.dataQualityPath || path.join(outputDir, 'data_quality_report.md');
    const processingLogPath = result?.processingLogPath || path.join(outputDir, 'processing_log.md');

    const updatedJob = {
      jobId,
      clientId,
      status: 'completed',
      ...result,
      dashboardPath: (dashboardPath && fs.existsSync(dashboardPath)) ? dashboardPath : null,
      pptPath: (pptPath && fs.existsSync(pptPath)) ? pptPath : null,
      reportPath: (reportPath && fs.existsSync(reportPath)) ? reportPath : null,
      dataQualityPath: (dataQualityPath && fs.existsSync(dataQualityPath)) ? dataQualityPath : null,
      processingLogPath: (processingLogPath && fs.existsSync(processingLogPath)) ? processingLogPath : null,
    };

    jobs[jobId] = updatedJob;

    // Update persistent metadata history with verified artifacts
    historyService.recordReport({
      jobId,
      clientId,
      clientName,
      location,
      reportPeriod: historyPeriodLabel,
      uploadedBy,
      status: 'completed',
      dashboardPath: updatedJob.dashboardPath,
      pptPath: updatedJob.pptPath,
      reportPath: updatedJob.reportPath,
      dataQualityPath: updatedJob.dataQualityPath,
      processingLogPath: updatedJob.processingLogPath,
      error: null,
    });
    historyService.cleanupOldReports(3);

    // Delete temp upload files post-processing
    historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);

    res.json({
      success: true,
      jobId,
      clientId,
      status: 'completed',
      metadata: updatedJob,
      dashboardPath: updatedJob.dashboardPath,
      pptPath: updatedJob.pptPath,
    });
  } catch (err) {
    console.error('[index] Engine upload error:', err.message);
    historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);
    jobs[jobId] = { status: 'error', error: err.message };
    historyService.recordReport({
      jobId,
      clientId,
      clientName,
      location,
      reportPeriod: historyPeriodLabel,
      uploadedBy,
      status: 'error',
      error: err.message,
    });
    res.status(500).json({ error: `Report processing error: ${err.message}` });
  }
});

// ── Job Status Endpoint (for frontend polling) ─────────────────────────────
app.get(['/api/status/:jobId', '/status/:jobId'], requireAuth, requireClientAccess(), (req, res) => {
  const { jobId } = req.params;
  const clientId = req.targetClientId;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found', status: 'not_found', code: 'JOB_NOT_FOUND' });
  }
  if (job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== clientId) {
    return res.status(403).json({
      error: `Customer isolation violation: Job '${jobId}' belongs to another customer.`,
      code: 'CUSTOMER_ISOLATION_VIOLATION',
    });
  }
  res.json({
    jobId,
    clientId: job.clientId,
    status: job.status || 'completed',
    error: job.error || null,
    dashboardPath: job.dashboardPath || null,
    pptPath: job.pptPath || null,
    pdfPath: job.pdfPath || null,
  });
});

// ── Google Sheets (Apps Script) → JSON upload ───────────────────────────────
// Additive route: builds temp .xlsx files from sheet rows and feeds the SAME
// validateUpload + processJFLWorkbooks pipeline used by POST /api/upload.
// NO calculation logic here. Additive only.

function buildXlsxBufferFromRows(sheetName, rows) {
  const XLSX = require('xlsx');
  // Google Sheets can send fully blank rows (formatting only). An Excel file has
  // no such rows, so drop them (keep header) to avoid phantom incidents/devices.
  const cleanRows = rows.filter(
    (r, i) => i === 0 || r.some((c) => c !== '' && c !== null && c !== undefined)
  );
  const ws = XLSX.utils.aoa_to_sheet(cleanRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName || 'Sheet1').slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function uploadJsonAuth(req, res, next) {
  const expectedKey = process.env.UPLOAD_API_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'UPLOAD_API_KEY is not configured on the server.' });
  }
  const provided = Buffer.from(String(req.headers['x-api-key'] || ''));
  const expected = Buffer.from(expectedKey);
  if (provided.length !== expected.length ||
      !require('crypto').timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized: invalid API key.' });
  }
  next();
}

app.post('/api/upload-json', uploadJsonAuth, heavyRateLimit, async (req, res) => {
  const body = req.body || {};
  const isRows = (s) => s && Array.isArray(s.rows) && s.rows.length >= 2 &&
                        s.rows.every((r) => Array.isArray(r));
  const startDate = String(body.start_date || '').trim();
  const endDate = String(body.end_date || '').trim();

  const dateValidation = validateDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    return res.status(400).json({
      error: 'Invalid date range',
      validationErrors: dateValidation.errors,
    });
  }
  if (!isRows(body.incidents)) {
    return res.status(400).json({
      error: 'incidents.rows must be an array of arrays with a header row and at least one data row.',
    });
  }
  const hasInventory = isRows(body.inventory);

  const rawClientId = String(body.clientId || '').trim();
  if (!rawClientId) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required for upload-json.' });
  }
  const client = clientService.getClientById(rawClientId);
  if (!client) {
    return res.status(400).json({ error: `Unknown customer identifier: "${rawClientId}". Upload rejected.` });
  }

  const clientId = client.id;
  const clientName = client.name;
  const location = 'All Locations';
  const uploadedBy = String(body.uploadedBy || 'Google Apps Script').slice(0, 120);

  const stamp = `${uuidv4()}_${Date.now()}`;
  const incidentPath = path.join(tempUploadDir, `${stamp}_incidents.xlsx`);
  const inventoryPath = hasInventory
    ? path.join(tempUploadDir, `${stamp}_inventory.xlsx`)
    : null;

  try {
    fs.writeFileSync(incidentPath, buildXlsxBufferFromRows(body.incidents.name, body.incidents.rows));
    if (inventoryPath) {
      fs.writeFileSync(inventoryPath, buildXlsxBufferFromRows(body.inventory.name, body.inventory.rows));
    }
  } catch (e) {
    historyService.cleanupTempFiles([incidentPath, inventoryPath]);
    return res.status(400).json({ error: `Could not build workbook from rows: ${e.message}` });
  }

  const validation = validateUpload(
    { path: incidentPath, originalname: 'incidents.xlsx' },
    inventoryPath ? { path: inventoryPath, originalname: 'inventory.xlsx' } : null
  );
  if (!validation.valid) {
    historyService.cleanupTempFiles([incidentPath, inventoryPath]);
    return res.status(400).json({
      error: 'Pre-upload validation failed',
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
    });
  }

  const jobId = uuidv4();
  const outputDir = path.join(REPORTS_DIR, `job_${jobId}`);
  const historyPeriodLabel = `${startDate} to ${endDate}`;

  const initialMeta = historyService.recordReport({
    jobId, clientId, clientName, location,
    reportPeriod: historyPeriodLabel, uploadedBy, status: 'processing',
  });
  jobs[jobId] = {
    jobId,
    clientId,
    status: 'processing',
    startedAt: new Date().toISOString(),
    outputDir,
    metadata: initialMeta,
  };

  setImmediate(() => {
    processJFLWorkbooks(incidentPath, inventoryPath, outputDir, {
      clientId,
      clientName,
      ruleConfigFile: client?.ruleConfigFile,
      startDate,
      endDate,
      reportingPeriod: historyPeriodLabel,
      periodMode: 'custom',
    })
      .then((result) => {
        const isSuccess = Boolean(result && result.success);
        const status = isSuccess ? 'completed' : 'failed';
        const dashboardPath = result?.dashboardPath || path.join(outputDir, 'dashboard_data.json');
        const pptPath = result?.pptPath || path.join(outputDir, `${client.code || 'CLIENT'}_QBR_Report.pptx`);
        const reportPath = result?.reportPath || path.join(outputDir, 'validation_report.md');
        const dataQualityPath = result?.dataQualityPath || path.join(outputDir, 'data_quality_report.md');
        const processingLogPath = result?.processingLogPath || path.join(outputDir, 'processing_log.md');
        const updatedJob = {
          jobId,
          clientId,
          status,
          ...result,
          dashboardPath: (dashboardPath && fs.existsSync(dashboardPath)) ? dashboardPath : null,
          pptPath: (pptPath && fs.existsSync(pptPath)) ? pptPath : null,
          reportPath: (reportPath && fs.existsSync(reportPath)) ? reportPath : null,
          dataQualityPath: (dataQualityPath && fs.existsSync(dataQualityPath)) ? dataQualityPath : null,
          processingLogPath: (processingLogPath && fs.existsSync(processingLogPath)) ? processingLogPath : null,
        };
        jobs[jobId] = updatedJob;

        historyService.recordReport({
          jobId, clientId, clientName, location,
          reportPeriod: historyPeriodLabel, uploadedBy, status,
          dashboardPath: updatedJob.dashboardPath,
          pptPath: updatedJob.pptPath,
          reportPath: updatedJob.reportPath,
          dataQualityPath: updatedJob.dataQualityPath,
          processingLogPath: updatedJob.processingLogPath,
          error: result?.error || null,
        });
      })
      .catch((err) => {
        console.error('[upload-json] Engine error:', err.message);
        jobs[jobId] = { status: 'error', error: err.message };
        historyService.recordReport({
          jobId, clientId, clientName, location,
          reportPeriod: historyPeriodLabel, uploadedBy, status: 'error', error: err.message,
        });
      })
      .finally(() => {
        historyService.cleanupTempFiles([incidentPath, inventoryPath]);
      });
  });

  res.json({ jobId, status: 'processing', metadata: initialMeta });
});

// ── Dashboard JSON Endpoint ────────────────────────────────────────────────
app.get(['/api/dashboard/:jobId', '/dashboard/:jobId', '/api/dashboard', '/dashboard'], requireAuth, requireClientAccess(), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const clientId = req.targetClientId;
  const client = req.targetClient;

  const reqJobId = req.params.jobId || req.query?.jobId || 'latest';
  const siteFilter = req.query.site || req.query.location || 'ALL';
  let job = null;
  let dPath = null;

  if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
    // Select newest completed job strictly belonging to requested customer
    job = resolveLatestCompletedJob(clientId);
    if (job) {
      const jobClientId = clientService.resolveCanonicalClientId(job.clientId);
      if (jobClientId !== clientId) {
        return res.status(403).json({ error: 'Customer isolation violation: Job does not belong to requested customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
      }
      dPath = job.dashboardPath;
    } else if (clientId === 'client-jfl') {
      const canonicalPath = path.resolve('data', 'dashboard_data.json');
      const bundledPath = path.resolve('data', 'bundled_default', 'dashboard_data.json');
      if (fs.existsSync(canonicalPath)) {
        dPath = canonicalPath;
      } else if (fs.existsSync(bundledPath)) {
        dPath = bundledPath;
      }
    }
  } else {
    // Explicit jobId provided
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    if (!job) {
      return res.status(404).json({ error: `Job '${reqJobId}' not found.`, code: 'JOB_NOT_FOUND' });
    }
    const jobClientId = clientService.resolveCanonicalClientId(job.clientId);
    if (jobClientId && jobClientId !== clientId) {
      return res.status(403).json({
        error: `Customer isolation violation: Job '${reqJobId}' belongs to customer '${job.clientId}', not '${clientId}'.`,
        code: 'CUSTOMER_ISOLATION_VIOLATION',
      });
    }
    if (job.status === 'processing') {
      return res.status(202).json({ status: 'processing', message: 'Report is generating...' });
    }
    if (job.status === 'error' || job.status === 'failed') {
      return res.status(500).json({ status: 'error', error: job.error || 'Job failed during processing.' });
    }
    dPath = job.dashboardPath;
  }

  try {
    if (!dPath || !fs.existsSync(dPath)) {
      return res.status(200).json({
        status: 'empty',
        message: `No completed dataset available for ${client.name || clientId}. Please upload files first.`,
        clientId
      });
    }

    // Verify artifact ownership if job-scoped
    if (job && job.jobId) {
      const expectedJobDir = path.resolve(REPORTS_DIR, `job_${job.jobId}`);
      const resolvedArtifact = path.resolve(dPath);
      const isUnderJobDir = resolvedArtifact.startsWith(expectedJobDir + path.sep) || resolvedArtifact === expectedJobDir;
      if (!isUnderJobDir) {
        return res.status(403).json({ error: 'Artifact ownership mismatch for requested customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
      }
    }

    const content = fs.readFileSync(dPath, 'utf8');
    const rawData = JSON.parse(content);

    // Cross-verify customer identifier in payload
    const rawDataClientId = rawData.clientId ? clientService.resolveCanonicalClientId(rawData.clientId) : null;
    if (rawDataClientId && rawDataClientId !== clientId) {
      return res.status(403).json({ error: 'Customer isolation violation: Dashboard payload belongs to another customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
    }

    const filteredData = filterDashboardBySite(rawData, siteFilter);
    if (!filteredData.iq200Audit) {
      try {
        const { continuousPipelineAudit } = require('./services/ai/iq200Validator');
        filteredData.iq200Audit = continuousPipelineAudit(filteredData);
      } catch (_) {}
    }
    res.json({ jobId: job?.jobId || reqJobId, clientId, ...filteredData });
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
    let targetPath = null;
    let authUser = null;
    let authorizedClientId = null;
    let authorizedJobId = null;

    // 1. Authenticate via Single-Use Download Ticket OR Bearer Token
    const ticket = req.query.ticket || req.query.downloadToken;
    if (ticket) {
      const ticketData = authService.verifyAndConsumeDownloadTicket(ticket);
      if (ticketData && ticketData.user) {
        authUser = ticketData.user;
        authorizedClientId = ticketData.clientId;
        authorizedJobId = ticketData.jobId;
      } else {
        const session = authService.verifyToken(ticket);
        if (session && session.user) {
          authUser = session.user;
        } else {
          return res.status(401).json({
            error: 'Invalid or expired download ticket.',
            code: 'INVALID_DOWNLOAD_TICKET',
          });
        }
      }
    } else {
      const session = authService.verifyToken(req.headers.authorization);
      if (!session || !session.user) {
        return res.status(401).json({
          error: 'Authorization required — please log in or provide a download ticket.',
          code: 'UNAUTHORIZED',
        });
      }
      authUser = session.user;
    }

    // 2. Client ID extraction & resolution
    const rawClientId = String(req.query.clientId || req.headers['x-client-id'] || authorizedClientId || '').trim();
    if (!rawClientId) {
      return res.status(400).json({ error: 'Customer identifier (clientId) is required for report download.', code: 'MISSING_CLIENT_ID' });
    }

    const client = clientService.getClientById(rawClientId);
    if (!client) {
      return res.status(404).json({ error: `Unknown customer '${rawClientId}'.`, code: 'UNKNOWN_CLIENT' });
    }
    const clientId = client.id;

    // If ticket was used, verify client matches ticket
    if (authorizedClientId && authorizedClientId !== clientId) {
      return res.status(403).json({
        error: 'Forbidden: Download ticket is not valid for requested customer.',
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }

    // 3. FAIL-CLOSED Role & Tenant Authorization Check
    if (!authUser || !authUser.role || !authUser.assignedClient) {
      return res.status(403).json({ error: 'Access denied: missing or invalid user profile.', code: 'INVALID_USER_ROLE' });
    }
    if (authUser.role !== 'admin' && authUser.role !== 'client_user') {
      return res.status(403).json({ error: 'Access denied: unrecognized user role.', code: 'UNRECOGNIZED_USER_ROLE' });
    }
    if (authUser.role !== 'admin') {
      const canonicalAssigned = clientService.resolveCanonicalClientId(authUser.assignedClient);
      if (!canonicalAssigned) {
        return res.status(403).json({ error: 'Access denied: unknown assigned customer.', code: 'UNKNOWN_ASSIGNED_CLIENT' });
      }
      if (canonicalAssigned !== clientId) {
        return res.status(403).json({
          error: `Forbidden: You are not authorized to download reports for customer '${client.name || rawClientId}'.`,
          code: 'CUSTOMER_ACCESS_FORBIDDEN',
        });
      }
    }

    const reqJobId = req.params.jobId || req.query?.jobId || 'latest';
    if (authorizedJobId && authorizedJobId !== 'latest' && reqJobId !== 'latest' && authorizedJobId !== reqJobId) {
      return res.status(403).json({
        error: 'Forbidden: Download ticket is not valid for requested job.',
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }

    let job = null;

    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      job = resolveLatestCompletedJob(clientId);
      if (!job && clientId === 'client-jfl') {
        const canonicalPath = path.resolve('data', 'dashboard_data.json');
        if (fs.existsSync(canonicalPath)) {
          job = {
            jobId: 'canonical-jfl',
            clientId: 'client-jfl',
            dashboardPath: canonicalPath,
            status: 'completed'
          };
        }
      }
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
      if (!job) {
        return res.status(404).json({ error: `Job '${reqJobId}' not found.`, code: 'JOB_NOT_FOUND' });
      }
      const jobClientId = clientService.resolveCanonicalClientId(job.clientId);
      if (jobClientId && jobClientId !== clientId) {
        return res.status(403).json({
          error: `Customer isolation violation: Job '${reqJobId}' belongs to customer '${job.clientId}', not '${clientId}'.`,
          code: 'CUSTOMER_ISOLATION_VIOLATION',
        });
      }
    }

    if (!job) {
      return res.status(404).json({
        error: `No report available for ${client.name || clientId}. Please upload and process a dataset first.`,
        code: 'REPORT_NOT_FOUND',
      });
    }

    if (job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== clientId) {
      return res.status(403).json({
        error: `Customer isolation violation: Job belongs to customer '${job.clientId}', not '${clientId}'.`,
        code: 'CUSTOMER_ISOLATION_VIOLATION',
      });
    }

    const activeJobId = job?.jobId || reqJobId;
    const jobOutputDir = path.join(REPORTS_DIR, `job_${activeJobId}`);
    const clientCode = (client.code || client.id || 'REPORT').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

    // ── PDF: Generate fresh PDF on-the-fly from job's own dashboard_data.json (SSOT guarantee) ────
    if (pathKey === 'pdfPath') {
      const dashCandidates = [
        job?.dashboardPath,
        path.join(jobOutputDir, 'dashboard_data.json'),
      ].filter(Boolean);

      const dashPath = dashCandidates.find((p) => p && fs.existsSync(p));

      if (dashPath) {
        try {
          console.log(`[server] Generating fresh Executive PDF Report on-the-fly from SSOT for ${client.name}: ${dashPath}`);
          if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });
          const freshPdfPath = path.join(jobOutputDir, `${clientCode}_QBR_${Date.now()}.pdf`);
          const qbrData = JSON.parse(fs.readFileSync(dashPath, 'utf8'));

          const qbrDataClientId = qbrData.clientId ? clientService.resolveCanonicalClientId(qbrData.clientId) : null;
          if (qbrDataClientId && qbrDataClientId !== clientId) {
            return res.status(403).json({ error: 'Customer isolation violation: Data artifact belongs to another customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
          }

          await generatePDF(qbrData, null, freshPdfPath);

          job.pdfPath = freshPdfPath;
          jobs[activeJobId] = { ...jobs[activeJobId], pdfPath: freshPdfPath };
          historyService.recordReport({
            ...job,
            jobId: activeJobId,
            clientId,
            status: 'completed',
            pdfPath: freshPdfPath,
          });

          targetPath = freshPdfPath;
        } catch (genErr) {
          console.error('[server] On-the-fly Executive PDF Report generation failed:', genErr.message);
          return res.status(500).json({ error: `Report generation failed: ${genErr.message}` });
        }
      } else {
        return res.status(404).json({ error: 'Dashboard data not found for report generation. Please re-upload your files.', code: 'DATASET_NOT_FOUND' });
      }

      const resolvedTarget = path.resolve(targetPath);
      const resolvedJobDir = path.resolve(jobOutputDir);
      const isUnderJobDir = resolvedTarget.startsWith(resolvedJobDir + path.sep) || resolvedTarget === resolvedJobDir;

      if (!isUnderJobDir) {
        console.error(`[server] SECURITY: Path traversal / job ownership violation. Requested: ${resolvedTarget}`);
        return res.status(403).json({ error: 'Artifact ownership mismatch for requested customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
      }

      console.log(`[server] Serving Executive PDF Report download: ${resolvedTarget}`);
      const fileHeader = fs.readFileSync(resolvedTarget, { encoding: null }).slice(0, 4).toString();
      const downloadPdfName = `${clientCode}_QBR_Executive_Report.pdf`;
      const downloadHtmlName = `${clientCode}_QBR_Executive_Report.html`;
      if (fileHeader === '%PDF') {
        return res.download(resolvedTarget, downloadPdfName);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.download(resolvedTarget, downloadHtmlName);
    }

    // ── PPT: Serve existing PPT or generate on-the-fly from job's own dashboard_data.json ──
    if (pathKey === 'pptPath') {
      // Task 1.2 (PPT-1): Timestamp-based cache invalidation.
      // If dashboard_data.json is newer than the cached .pptx, discard the cache so
      // the download always reflects the latest SSOT data (e.g. after a Phase B re-process).
      let cachedPptValid = false;
      if (job?.pptPath && fs.existsSync(job.pptPath)) {
        const dashCandidatesCheck = [
          job?.dashboardPath,
          path.join(jobOutputDir, 'dashboard_data.json'),
        ].filter(Boolean);
        const dashPathCheck = dashCandidatesCheck.find((p) => p && fs.existsSync(p));
        if (dashPathCheck) {
          const pptMtime = fs.statSync(job.pptPath).mtimeMs;
          const dashMtime = fs.statSync(dashPathCheck).mtimeMs;
          if (pptMtime >= dashMtime) {
            // Cache is fresh — serve it
            cachedPptValid = true;
            targetPath = job.pptPath;
          } else {
            console.log(`[server] PPT cache stale (ppt: ${new Date(pptMtime).toISOString()} < dash: ${new Date(dashMtime).toISOString()}). Regenerating from SSOT.`);
            // Invalidate so the else-branch below regenerates
            job.pptPath = null;
          }
        } else {
          // No dashboard file to compare — trust the cache
          cachedPptValid = true;
          targetPath = job.pptPath;
        }
      }
      if (!cachedPptValid) {
        const dashCandidates = [
          job?.dashboardPath,
          path.join(jobOutputDir, 'dashboard_data.json'),
        ].filter(Boolean);

        const dashPath = dashCandidates.find((p) => p && fs.existsSync(p));
        if (dashPath) {
          try {
            console.log(`[server] Generating fresh Executive PPT Report on-the-fly from SSOT for ${client.name}: ${dashPath}`);
            if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });
            const freshPptPath = path.join(jobOutputDir, `${clientCode}_QBR_${Date.now()}.pptx`);
            const templatePath = path.resolve('templates', 'master_template.pptx');
            const qbrData = JSON.parse(fs.readFileSync(dashPath, 'utf8'));

            const qbrDataClientId = qbrData.clientId ? clientService.resolveCanonicalClientId(qbrData.clientId) : null;
            if (qbrDataClientId && qbrDataClientId !== clientId) {
              return res.status(403).json({ error: 'Customer isolation violation: Data artifact belongs to another customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
            }

            await generatePPT(qbrData, templatePath, freshPptPath);
            job.pptPath = freshPptPath;
            jobs[activeJobId] = { ...jobs[activeJobId], pptPath: freshPptPath };
            historyService.recordReport({
              ...job,
              jobId: activeJobId,
              clientId,
              status: 'completed',
              pptPath: freshPptPath,
            });
            targetPath = freshPptPath;
          } catch (pptGenErr) {
            console.error('[server] On-the-fly Executive PPT Report generation failed:', pptGenErr.message);
            return res.status(500).json({ error: `PPT generation failed: ${pptGenErr.message}` });
          }
        } else {
          return res.status(404).json({ error: 'Dashboard data not found for PPT generation. Please re-upload your files.', code: 'DATASET_NOT_FOUND' });
        }
      }

      const resolvedTarget = path.resolve(targetPath);
      const resolvedJobDir = path.resolve(jobOutputDir);
      const isUnderJobDir = resolvedTarget.startsWith(resolvedJobDir + path.sep) || resolvedTarget === resolvedJobDir;
      if (!isUnderJobDir) {
        console.error(`[server] SECURITY: Path traversal / job ownership violation. Requested: ${resolvedTarget}`);
        return res.status(403).json({ error: 'Artifact ownership mismatch for requested customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
      }

      console.log(`[server] Serving Executive PPT Report download: ${resolvedTarget}`);
      const downloadPptName = `${clientCode}_QBR_Report.pptx`;
      return res.download(resolvedTarget, downloadPptName);
    }

    // ── Non-PPT/PDF files: reports, logs, etc. ──────────────────
    targetPath = job?.[pathKey];
    if (!targetPath || !fs.existsSync(targetPath)) {
      const candidates = [
        path.join(jobOutputDir, defaultFilename),
        path.join(jobOutputDir, `${defaultFilename}`),
      ];
      targetPath = candidates.find((p) => fs.existsSync(p));
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      if (fs.existsSync(jobOutputDir)) {
        const files = fs.readdirSync(jobOutputDir);
        const match = files.find(f => f.toLowerCase().endsWith('.md') && pathKey === 'reportPath');
        if (match) {
          targetPath = path.join(jobOutputDir, match);
        }
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: `${pathKey} file not available for job ${activeJobId}`, code: 'FILE_NOT_FOUND' });
    }

    const resolvedTarget = path.resolve(targetPath);
    const resolvedJobDir = path.resolve(jobOutputDir);
    const isUnderJobDir = resolvedTarget.startsWith(resolvedJobDir + path.sep) || resolvedTarget === resolvedJobDir;

    if (!isUnderJobDir) {
      console.error(`[server] SECURITY: Artifact does not belong to job directory: ${resolvedTarget}`);
      return res.status(403).json({ error: 'Artifact ownership mismatch for requested customer.', code: 'CUSTOMER_ISOLATION_VIOLATION' });
    }

    console.log(`[server] Serving file download: ${resolvedTarget}`);
    res.download(resolvedTarget, `${clientCode}_${defaultFilename}`);
  } catch (err) {
    console.error('[server] Download error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

app.get(['/api/pdf/:jobId', '/pdf/:jobId', '/api/pdf', '/pdf'], sendFileHelper('pdfPath', 'QBR_Report.pdf'));
app.get(['/api/ppt/:jobId', '/ppt/:jobId', '/api/ppt', '/ppt'], sendFileHelper('pptPath', 'QBR_Report.pptx'));
app.get(['/api/report/pdf', '/report/pdf'], (req, res, next) => {
  req.params = { ...req.params, jobId: 'latest' };
  return sendFileHelper('pdfPath', 'QBR_Report.pdf')(req, res, next);
});
app.get(['/api/report/:jobId', '/report/:jobId'], sendFileHelper('reportPath', 'validation_report.md'));
app.get(['/api/error-report/:jobId', '/error-report/:jobId'], sendFileHelper('errorReportPath', 'error_report.json'));
app.get(['/api/data-quality/:jobId', '/data-quality/:jobId'], sendFileHelper('dataQualityPath', 'data_quality_report.md'));
app.get(['/api/processing-log/:jobId', '/processing-log/:jobId'], sendFileHelper('processingLogPath', 'processing_log.md'));

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

  // ── Startup Cache Eviction Guard ─────────────────
  try {
    const canonicalPath = resolveDataPath('dashboard_data.json');
    if (fs.existsSync(canonicalPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
        const reportLabel = parsed?.report_period?.display_label || parsed?.reportingPeriod || '';
        
        if (reportLabel === 'User Selected Period' || reportLabel === 'Selected Period' || reportLabel === '') {
          console.warn('[startup] Stale or placeholder dashboard_data.json detected. Evicting cache and copying bundled default.');
          const bundledPath = resolveDataPath('bundled_default/dashboard_data.json');
          if (fs.existsSync(bundledPath)) {
            fs.copyFileSync(bundledPath, canonicalPath);
            console.log('[startup] Successfully restored bundled default dashboard_data.json');
          }
        } else {
          const n = parsed?.executiveSummary?.totalIncidents;
          console.log(`[startup] Canonical dashboard_data.json present (${n ?? 'unknown'} incidents).`);
        }
      } catch (e) {
        console.warn('[startup] Canonical dashboard_data.json exists but is unreadable:', e.message);
      }
    } else {
      console.log('[startup] No canonical dashboard_data.json — empty state until first upload.');
      const bundledPath = resolveDataPath('bundled_default/dashboard_data.json');
      if (fs.existsSync(bundledPath)) {
        fs.copyFileSync(bundledPath, canonicalPath);
        console.log('[startup] Copied bundled default to canonical path.');
      }
    }
  } catch (err) {
    console.warn('[startup] Warning during startup cache validation:', err.message);
  }

  historyService.cleanupOldReports(3);
  (async () => {
    try {
      const result = await migrate();
      console.log('[Phase G] Turso schema ready:',
                  result.statementsRun, 'statements in',
                  result.durationMs, 'ms');
      const health = await healthCheck();
      if (!health.healthy) {
        throw new Error('Turso health check failed: ' + health.error);
      }
      console.log('[Phase G] Turso connection healthy');
    } catch (err) {
      console.error('[Phase G] FATAL: migration/health failed:', err.message);
      process.exit(1);
    }
    startServer(Number(DEFAULT_PORT));
  })().catch((err) => {
    console.error('[Phase G] FATAL startup error:', err);
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
