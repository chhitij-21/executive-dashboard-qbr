// backend/index.js — Executive Dashboard & Multi-Client QBR Web Portal API
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');

const { processJFLWorkbooks } = require('./services/processData');
const clientService = require('./services/clientService');
const historyService = require('./services/historyService');
const { validateUpload } = require('./services/uploadValidationService');
const authService = require('./services/authService');
const ruleEngine = require('./services/ruleEngine');

const app = express();

// ── CORS: allow localhost, onrender.com subdomains, and configured origins ────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, same-origin in prod)
    if (!origin) return callback(null, true);

    try {
      const hostname = new URL(origin).hostname;
      if (
        hostname.endsWith('.onrender.com') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        ALLOWED_ORIGINS.some((o) => origin.startsWith(o))
      ) {
        return callback(null, true);
      }
    } catch (e) {}

    callback(new Error(`CORS: Origin ${origin} is not allowed.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json());

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

app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Directories (os.tmpdir fallback for Vercel serverless environment)
const INCOMING_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'incoming')
  : path.resolve('data', 'incoming');
const REPORTS_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'reports')
  : path.resolve('reports');

[INCOMING_DIR, REPORTS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
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

app.post(['/api/auth/login', '/auth/login'], (req, res) => {
  const { email, password } = req.body;
  const session = authService.authenticateUser(email, password);
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

// ── Client & Location Management Routes ─────────────────────────────────────
app.get(['/api/clients', '/clients'], (req, res) => {
  res.json({ clients: clientService.getAllClients() });
});

app.get('/api/clients/:id', (req, res) => {
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
    const result = ruleEngine.saveRulesYaml(rawYaml);
    res.json({ success: true, message: 'rules.yaml updated successfully', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid YAML format' });
  }
});

// ── Report History Route ────────────────────────────────────────────────────
app.get(['/api/history', '/history'], (req, res) => {
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

// ── Upload & Report Generation Workflow Endpoint ────────────────────────────
app.post(['/api/upload', '/upload'], requireAuth, upload.fields([
  { name: 'incidents', maxCount: 1 },
  { name: 'inventory', maxCount: 1 },
  { name: 'excel', maxCount: 1 }, // legacy fallback
]), async (req, res) => {
  const incidentFile = req.files?.incidents?.[0] || req.files?.excel?.[0] || null;
  const inventoryFile = req.files?.inventory?.[0] || null;

  const clientId = req.body.clientId || 'client-jfl';
  const location = req.body.location || 'All Locations';
  const reportPeriod = req.body.reportPeriod || 'Q1 FY2026';
  const uploadedBy = req.body.uploadedBy || 'System User';

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

  // 2. Record initial metadata history (Status: Processing)
  const initialMeta = historyService.recordReport({
    jobId,
    clientId,
    clientName,
    location,
    reportPeriod,
    uploadedBy,
    status: 'processing',
  });

  jobs[jobId] = {
    status: 'processing',
    startedAt: new Date().toISOString(),
    outputDir,
    metadata: initialMeta
  };

  // 3. Trigger Existing Processing Engine (UNTOUCHED Core logic)
  processJFLWorkbooks(incidentFile.path, inventoryFile ? inventoryFile.path : null, outputDir)
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
        reportPeriod,
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

  res.json({ jobId, status: 'processing', metadata: initialMeta });
});

// ── Dashboard JSON Endpoint ────────────────────────────────────────────────
app.get(['/api/dashboard/:jobId', '/dashboard/:jobId'], async (req, res) => {
  const reqJobId = req.params.jobId;
  let job = null;

  if (reqJobId === 'latest' || reqJobId === 'default') {
    const history = historyService.getHistory();
    job = history.find((h) => h.status === 'completed') || Object.values(jobs).find((j) => j.status === 'completed');

    if (!job && reqJobId === 'default') {
      // Process default master dataset only when explicitly requested via 'default' route
      const incPath = fs.existsSync(path.resolve('jfl incidents.xlsx'))
        ? path.resolve('jfl incidents.xlsx')
        : path.join(__dirname, '..', 'jfl incidents.xlsx');
      const invPath = fs.existsSync(path.resolve('JFL Updated Inventory.xlsx'))
        ? path.resolve('JFL Updated Inventory.xlsx')
        : path.join(__dirname, '..', 'JFL Updated Inventory.xlsx');

      if (fs.existsSync(incPath)) {
        try {
          console.log('[server] Processing default sample dataset upon manual user request...');
          const autoJobId = 'master-jfl-q1-fy2026';
          const outputDir = path.join(REPORTS_DIR, `job_${autoJobId}`);

          const result = await processJFLWorkbooks(
            incPath,
            fs.existsSync(invPath) ? invPath : null,
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
        } catch (err) {
          console.error('[server] Error processing default dataset:', err.message);
        }
      }
    }
  } else {
    job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
  }

  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed') return res.status(202).json({ status: job.status, error: job.error });

  let dPath = job.dashboardPath;
  if (!dPath || !fs.existsSync(dPath)) {
    dPath = path.join(REPORTS_DIR, `job_${job.jobId || reqJobId}`, 'dashboard_data.json');
  }
  if (!fs.existsSync(dPath)) {
    dPath = path.join(REPORTS_DIR, `job_${job.jobId || reqJobId}`, 'dashboard.json');
  }

  try {
    if (!fs.existsSync(dPath)) return res.status(404).json({ error: 'Dashboard JSON not found' });
    const content = fs.readFileSync(dPath, 'utf8');
    res.json(JSON.parse(content));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Download Helpers ─────────────────────────────────────────────────────────
const sendFileHelper = (pathKey, defaultFilename) => async (req, res) => {
  try {
    const reqJobId = req.params.jobId;
    let job = null;

    if (reqJobId === 'latest' || reqJobId === 'default') {
      const history = historyService.getHistory();
      job = history.find((h) => h.status === 'completed') || Object.values(jobs).find((j) => j.status === 'completed');
    } else {
      job = jobs[reqJobId] || historyService.getReportByJobId(reqJobId);
    }

    // Auto-generate default dataset if job doesn't exist yet
    if (!job) {
      const incPath = fs.existsSync(path.resolve('jfl incidents.xlsx'))
        ? path.resolve('jfl incidents.xlsx')
        : path.join(__dirname, '..', 'jfl incidents.xlsx');
      const invPath = fs.existsSync(path.resolve('JFL Updated Inventory.xlsx'))
        ? path.resolve('JFL Updated Inventory.xlsx')
        : path.join(__dirname, '..', 'JFL Updated Inventory.xlsx');

      if (fs.existsSync(incPath)) {
        console.log('[server] Auto-processing sample dataset for download request...');
        const autoJobId = 'master-jfl-q1-fy2026';
        const outputDir = path.join(REPORTS_DIR, `job_${autoJobId}`);

        const result = await processJFLWorkbooks(
          incPath,
          fs.existsSync(invPath) ? invPath : null,
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

    let targetPath = job[pathKey];
    if (!targetPath || !fs.existsSync(targetPath)) {
      const activeJobId = job.jobId || reqJobId;
      targetPath = path.join(REPORTS_DIR, `job_${activeJobId}`, defaultFilename);
    }

    // Search directory for matching file extension if targetPath not directly found
    if (!fs.existsSync(targetPath)) {
      const activeJobId = job.jobId || reqJobId;
      const jobDir = path.join(REPORTS_DIR, `job_${activeJobId}`);
      if (fs.existsSync(jobDir)) {
        const files = fs.readdirSync(jobDir);
        const match = files.find(f => f.toLowerCase().endsWith('.pptx') && pathKey === 'pptPath')
          || files.find(f => f.toLowerCase().endsWith('.md') && pathKey === 'reportPath');
        if (match) targetPath = path.join(jobDir, match);
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: `${pathKey} file not available on server` });
    }

    console.log(`[server] Serving file download: ${targetPath}`);
    res.download(targetPath);
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

// ── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const idxFrontend = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  const idxRoot = path.join(__dirname, '..', 'dist', 'index.html');
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
