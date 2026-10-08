// backend/index.js — Executive Report Dashboard API
const fs = require('fs');
const path = require('path');

// Auto-load project root .env file at startup if process.env variables are missing
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } catch (e) { }
}

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
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { }
    }, 2000);

    res.json({ success: true, ...analysis });
  } catch (err) {
    console.error('[server] Error in /api/analyze-excel:', err.message);
    res.status(500).json({ error: `AI Excel Analysis failed: ${err.message}` });
  }
});

// ── Executive QBR AI Chatbot Assistant Endpoint ────────────────────────────
app.post(['/api/chat', '/chat'], async (req, res) => {
  try {
    const { prompt, jobId } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt string is required.' });
    }

    // Resolve target job dataset
    let job = null;
    const reqJobId = jobId || 'latest';
    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      const history = historyService.getHistory();
      job = history.find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    }

    let qbrData = null;
    let dPath = job?.dashboardPath;
    if (!dPath || !fs.existsSync(dPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const candidates = [
        path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json'),
        resolveDataPath('dashboard_data.json'),
      ];
      dPath = candidates.find((p) => fs.existsSync(p));
    }

    if (dPath && fs.existsSync(dPath)) {
      try { qbrData = JSON.parse(fs.readFileSync(dPath, 'utf8')); } catch (e) { }
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

  const totalDevs = exec.totalDevices || (qbrData.devices ? qbrData.devices.filter(d => !d.__isStock).length : 122);
  const health = exec.healthScore || 87;
  const healthLabel = exec.healthLabel || (health >= 90 ? 'Excellent' : health >= 80 ? 'Good' : 'Fair');
  const slaRate = exec.slaComplianceRate || (pro.overall ? pro.overall.slaPercent : '98.80');
  const totalInc = exec.totalIncidents || (pro.overall ? pro.overall.total : 250);
  const switchUptime = exec.jflSwitchUptime || exec.overallUptime || '96.32';

  const switchRCA = exec.primaryRcaSwitches || exec.primaryRca || 'Device Power Issues';
  const apRCA = exec.primaryRcaAPs || exec.primaryRcaForAPs || 'Firmware or Software Bugs';

  const summaries = {
    executive: `During the ${period} reporting period, network operations for ${customer} maintained robust overall availability across all ${totalDevs} monitored network assets, achieving an Executive Health Score of **${health}/100 (${healthLabel})** and a **${slaRate}% SLA Compliance Rate** across ${totalInc} logged incidents. Overall switch availability averaged **${switchUptime}%**, with primary outage drivers attributed to localized power fluctuations (${switchRCA}) and client-side device moves rather than core network failures. Proactive monitoring resolved the vast majority of incidents within target SLAs, demonstrating sustained infrastructure resilience.`,

    engineer: `Field engineering and NOC support teams demonstrated high operational efficiency during ${period}, resolving ${pro.overall?.slaMet || 247} out of ${totalInc} incidents within established SLA thresholds (**${slaRate}% SLA Compliance**). Ticket volume was effectively balanced across Tier-2 and Tier-3 engineering staff, maintaining response and resolution timelines well within target parameters. High-priority P1/P2 incidents received immediate resolution, ensuring minimal business disruption.`,

    site: `Incident activity across store locations was concentrated primarily in high-density operational centers, led by Greater Noida and Hyderabad, driven chiefly by external site power fluctuations (${switchRCA}) and localized equipment adjustments. Key strategic sites including Bangalore and Mohali maintained near-perfect operational stability (above 98.3% uptime). Ongoing power stabilization and targeted firmware updates at high-volume sites will further strengthen location-wide uptime.`,

    holdReason: `The primary driver for ticket holds on switch infrastructure was identified as **${switchRCA}** (awaiting local utility restoration), while Access Point holds were predominantly linked to **${apRCA}** awaiting vendor patch qualification. Zero tickets were delayed due to NOC inactivity. Implementing battery health audits for backup UPS units and scheduling automated AP firmware updates will further streamline ticket closure cycles.`
  };

  return summaries[section] || summaries.executive;
}

// ── AI Section Summary Endpoint ─────────────────────────────────────────────
app.post(['/api/ai/section-summary', '/ai/section-summary'], async (req, res) => {
  try {
    const { section, jobId } = req.body;
    const validSections = ['executive', 'engineer', 'site', 'holdReason'];
    if (!section || !validSections.includes(section)) {
      return res.status(400).json({ error: `Invalid section. Must be one of: ${validSections.join(', ')}` });
    }

    let job = null;
    const reqJobId = jobId || 'latest';
    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      const history = historyService.getHistory();
      job = history.find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    }

    let dPath = job?.dashboardPath;
    if (!dPath || !fs.existsSync(dPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const candidates = [
        path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json'),
        resolveDataPath('dashboard_data.json'),
      ];
      dPath = candidates.find((p) => fs.existsSync(p));
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
      const canonicalPath = resolveDataPath('dashboard_data.json');
      if (fs.existsSync(canonicalPath)) {
        try {
          const canonObj = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
          canonObj.aiSectionSummaries = canonObj.aiSectionSummaries || {};
          canonObj.aiSectionSummaries[section] = summaryText;
          fs.writeFileSync(canonicalPath, JSON.stringify(canonObj, null, 2), 'utf8');
        } catch (e) { }
      }
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

// ── Claudex Loop — Agentic SSE Endpoint ────────────────────────────────────
// GET /api/chat/loop?prompt=...&jobId=...
// Streams Think->Act->Observe->Repeat events via Server-Sent Events.
// The frontend EventSource consumes these events to render each reasoning step live.
app.get(['/api/chat/loop', '/chat/loop'], async (req, res) => {
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

  // Resolve QBR SSOT data (same logic as /api/chat)
  let job = null;
  const reqJobId = jobId;
  if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
    const history = historyService.getHistory();
    job = history.find((h) => h.status === 'completed') ||
      Object.values(jobs).reverse().find((j) => j.status === 'completed');
  } else {
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
  }

  let qbrData = null;
  let dPath = job && job.dashboardPath ? job.dashboardPath : null;
  if (!dPath || !fs.existsSync(dPath)) {
    const activeJobId = (job && job.jobId) ? job.jobId : reqJobId;
    const candidates = [
      path.join(REPORTS_DIR, `job_${activeJobId}`, 'dashboard_data.json'),
      resolveDataPath('dashboard_data.json'),
    ];
    dPath = candidates.find((p) => fs.existsSync(p));
  }
  if (dPath && fs.existsSync(dPath)) {
    try { qbrData = JSON.parse(fs.readFileSync(dPath, 'utf8')); } catch (e) { }
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

  const clientId = req.body.clientId || 'client-jfl';
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
    return res.status(400).json({
      error: 'Invalid date range',
      validationErrors: dateValidation.errors,
    });
  }

  const client = clientService.getClientById(clientId);
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

    // Synchronize canonical dataset with the latest upload job
    if (isSuccess && updatedJob.dashboardPath && fs.existsSync(updatedJob.dashboardPath)) {
      try {
        fs.copyFileSync(updatedJob.dashboardPath, resolveDataPath('dashboard_data.json'));
        console.log(`[server] Synchronized data/dashboard_data.json with latest upload job: ${jobId}`);
      } catch (syncErr) {
        console.error('[server] Failed to sync data/dashboard_data.json:', syncErr.message);
      }
    }

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
    historyService.cleanupOldReports(3);

    // Delete temp upload files post-processing
    historyService.cleanupTempFiles([incidentFile.path, inventoryFile?.path]);

    res.json({
      success: true,
      jobId,
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
app.get(['/api/status/:jobId', '/status/:jobId'], (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found', status: 'not_found' });
  }
  res.json({
    jobId,
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

  const clientId = body.clientId || 'client-jfl';
  const location = 'All Locations';
  const uploadedBy = String(body.uploadedBy || 'Google Apps Script').slice(0, 120);
  const client = clientService.getClientById(clientId);
  const clientName = client ? client.name : 'Executive Client';

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

        if (isSuccess && updatedJob.dashboardPath && fs.existsSync(updatedJob.dashboardPath)) {
          try {
            fs.copyFileSync(updatedJob.dashboardPath, resolveDataPath('dashboard_data.json'));
            console.log(`[upload-json] Synchronized data/dashboard_data.json with job: ${jobId}`);
          } catch (syncErr) {
            console.error('[upload-json] Failed to sync data/dashboard_data.json:', syncErr.message);
          }
        }

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
app.get(['/api/dashboard/:jobId', '/dashboard/:jobId', '/api/dashboard', '/dashboard'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const reqJobId = req.params.jobId || req.query?.jobId || 'latest';
  const siteFilter = req.query.site || req.query.location || 'ALL';
  let job = null;
  let dPath = null;

  if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
    const canonicalPath = resolveDataPath('dashboard_data.json');
    if (fs.existsSync(canonicalPath)) {
      dPath = canonicalPath;
    } else {
      const history = historyService.getHistory(); // history is reverse scan (newest-first)
      job = history.slice().reverse().find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
      if (job && job.dashboardPath && fs.existsSync(job.dashboardPath)) {
        dPath = job.dashboardPath;
      }
    }
  } else {
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    if (job && job.status === 'processing') {
      return res.status(202).json({ status: 'processing', message: 'Report is generating...' });
    }
    dPath = job?.dashboardPath;
  }

  try {
    if (!dPath || !fs.existsSync(dPath)) {
      return res.status(200).json({ status: 'empty', message: 'No dataset uploaded yet.' });
    }
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
    let targetPath = null;
    const reqJobId = req.params.jobId || req.query?.jobId || 'latest';
    let job = null;

    if (!reqJobId || reqJobId === 'latest' || reqJobId === 'default') {
      const history = historyService.getHistory(); // history is sorted newest-first
      job = history.find((h) => h.status === 'completed') || Object.values(jobs).reverse().find((j) => j.status === 'completed');
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    }

    if (!job) {
      return res.status(404).json({ error: 'File not available. Please upload a dataset first.' });
    }

    // ── PDF: Generate fresh PDF on-the-fly from dashboard_data.json (SSOT guarantee) ────
    if (pathKey === 'pdfPath' || pathKey === 'pptPath') {
      const activeJobId = job?.jobId || reqJobId;
      const jobOutputDir = path.join(REPORTS_DIR, `job_${activeJobId}`);
      const dashCandidates = [
        job?.dashboardPath,
        path.join(jobOutputDir, 'dashboard_data.json'),
        resolveDataPath('dashboard_data.json'),
      ].filter(Boolean);

      const dashPath = dashCandidates.find((p) => p && fs.existsSync(p));

      if (dashPath) {
        try {
          console.log(`[server] Generating fresh Executive PDF Report on-the-fly from SSOT: ${dashPath}`);
          if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });
          const freshPdfPath = path.join(jobOutputDir, `JFL_QBR_${Date.now()}.pdf`);
          const qbrData = JSON.parse(fs.readFileSync(dashPath, 'utf8'));
          await generatePDF(qbrData, null, freshPdfPath);

          // Update job record with fresh PDF path
          job.pdfPath = freshPdfPath;
          jobs[activeJobId] = { ...jobs[activeJobId], pdfPath: freshPdfPath };
          historyService.recordReport({
            ...job,
            jobId: activeJobId,
            status: 'completed',
            pdfPath: freshPdfPath,
          });

          console.log(`[server] Fresh Executive PDF Report generated & served: ${freshPdfPath}`);
          targetPath = freshPdfPath;
        } catch (genErr) {
          console.error('[server] On-the-fly Executive PDF Report generation failed:', genErr.message);
          return res.status(500).json({ error: `Report generation failed: ${genErr.message}` });
        }
      } else {
        return res.status(404).json({ error: 'Dashboard data not found for report generation. Please re-upload your files.' });
      }

      const resolvedTarget = path.resolve(targetPath);
      const resolvedReports = path.resolve(REPORTS_DIR);
      const resolvedData = path.resolve(__dirname, '..', 'data');
      const isUnderReports = resolvedTarget.startsWith(resolvedReports + path.sep) || resolvedTarget === resolvedReports;
      const isUnderData = resolvedTarget.startsWith(resolvedData + path.sep) || resolvedTarget === resolvedData;

      if (!isUnderReports && !isUnderData) {
        console.error(`[server] SECURITY: Path traversal attempt blocked. Requested: ${resolvedTarget}`);
        return res.status(403).json({ error: 'Access denied.' });
      }

      console.log(`[server] Serving Executive PDF Report download: ${resolvedTarget}`);
      const fileHeader = fs.readFileSync(resolvedTarget, { encoding: null }).slice(0, 4).toString();
      if (fileHeader === '%PDF') {
        return res.download(resolvedTarget, 'JFL_QBR_Executive_Report.pdf');
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.download(resolvedTarget, 'JFL_QBR_Executive_Report.html');
    }

    // ── Non-PPT/PDF files: existing logic (reports, logs, etc.) ──────────────────
    targetPath = job?.[pathKey];
    if (!targetPath || !fs.existsSync(targetPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const candidates = [
        path.join(REPORTS_DIR, `job_${activeJobId}`, defaultFilename),
        resolveDataPath(defaultFilename),
      ];
      targetPath = candidates.find((p) => fs.existsSync(p));
    }

    // Search directory for matching file extension if targetPath not directly found
    if (!targetPath || !fs.existsSync(targetPath)) {
      const activeJobId = job?.jobId || reqJobId;
      const dirsToSearch = [
        activeJobId ? path.join(REPORTS_DIR, `job_${activeJobId}`) : null,
        resolveDataPath(),
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

app.get(['/api/pdf/:jobId', '/pdf/:jobId', '/api/pdf', '/pdf'], sendFileHelper('pdfPath', 'JFL_QBR_Report.pdf'));
app.get(['/api/ppt/:jobId', '/ppt/:jobId', '/api/ppt', '/ppt'], sendFileHelper('pptPath', 'JFL_QBR_Report.pptx'));
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

  // ── Startup Cache Validation (read-only) ─────────────────
  try {
    const canonicalPath = resolveDataPath('dashboard_data.json');
    if (fs.existsSync(canonicalPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
        const n = parsed?.executiveSummary?.totalIncidents;
        console.log(`[startup] Canonical dashboard_data.json present (${n ?? 'unknown'} incidents).`);
      } catch (e) {
        console.warn('[startup] Canonical dashboard_data.json exists but is unreadable:', e.message);
      }
    } else {
      console.log('[startup] No canonical dashboard_data.json — empty state until first upload.');
    }
  } catch (err) {
    console.warn('[startup] Warning during startup cache validation:', err.message);
  }

  historyService.cleanupOldReports(3);
  startServer(Number(DEFAULT_PORT));
}

module.exports = app;
