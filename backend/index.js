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

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

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
const upload = multer({ dest: tempUploadDir });

// In-memory active job cache
const jobs = {};

// ── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const session = authService.authenticateUser(email, password);
  if (!session) return res.status(401).json({ error: 'Invalid email or password' });
  res.json(session);
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const session = authService.verifyToken(authHeader);
  if (!session) return res.status(401).json({ error: 'Unauthorized session' });
  res.json(session);
});

app.get('/api/auth/demo-accounts', (req, res) => {
  res.json({ users: authService.getDemoUsers() });
});

// ── Client & Location Management Routes ─────────────────────────────────────
app.get('/api/clients', (req, res) => {
  res.json({ clients: clientService.getAllClients() });
});

app.get('/api/clients/:id', (req, res) => {
  const client = clientService.getClientById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

app.post('/api/clients', (req, res) => {
  try {
    const newClient = clientService.createClient(req.body);
    res.status(201).json({ client: newClient });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/clients/:id', (req, res) => {
  const updated = clientService.updateClient(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

app.post('/api/clients/:id/locations', (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: 'Location name is required' });
  const updated = clientService.addLocation(req.params.id, location);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

// ── Report History Route ────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  const { clientId, location, status } = req.query;
  const history = historyService.getHistory({ clientId, location, status });
  res.json({ history });
});

// ── Health Route ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Upload & Report Generation Workflow Endpoint ────────────────────────────
app.post('/api/upload', upload.fields([
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
app.get('/api/dashboard/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed') return res.status(202).json({ status: job.status, error: job.error });

  let dPath = job.dashboardPath;
  if (!dPath || !fs.existsSync(dPath)) {
    dPath = path.join(REPORTS_DIR, `job_${jobId}`, 'dashboard_data.json');
  }
  if (!fs.existsSync(dPath)) {
    dPath = path.join(REPORTS_DIR, `job_${jobId}`, 'dashboard.json');
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
const sendFileHelper = (pathKey, defaultFilename) => (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const targetPath = job[pathKey] || path.join(REPORTS_DIR, `job_${jobId}`, defaultFilename);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(404).json({ error: `${pathKey} file not available` });
  }
  res.download(targetPath);
};

app.get('/api/ppt/:jobId', sendFileHelper('pptPath', 'QBR_Presentation.pptx'));
app.get('/api/report/:jobId', sendFileHelper('reportPath', 'validation_report.md'));
app.get('/api/error-report/:jobId', sendFileHelper('errorReportPath', 'error_report.json'));
app.get('/api/data-quality/:jobId', sendFileHelper('dataQualityPath', 'data_quality_report.md'));
app.get('/api/processing-log/:jobId', sendFileHelper('processingLogPath', 'processing_log.md'));

// ── Job Status Route ────────────────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId] || historyService.getReportByJobId(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId, ...job });
});

// ── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const idxRoot = path.join(__dirname, '..', 'dist', 'index.html');
  const idxFrontend = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  if (fs.existsSync(idxRoot)) return res.sendFile(idxRoot);
  if (fs.existsSync(idxFrontend)) return res.sendFile(idxFrontend);
  res.json({ message: 'Executive Dashboard & Multi-Client QBR Portal API running.' });
});

if (require.main === module || !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Multi-Client Web Portal running at http://localhost:${PORT}`);
    console.log(`[server] Reports directory: ${REPORTS_DIR}`);
  });
}

module.exports = app;
