// backend/routes/templateRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const templateService = require('../services/templateService');
const clientService = require('../services/clientService');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.pptx') {
      return cb(new Error(`File type not allowed: ${file.originalname}. Only .pptx templates are accepted.`));
    }
    cb(null, true);
  },
});

function handleTemplateUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    let message = 'Upload limit error';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Uploaded file exceeds the maximum allowed size of 30 MB.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded in a single request.';
    }
    return res.status(400).json({ error: message, code: err.code });
  }
  if (err) {
    return res.status(400).json({ error: err.message, code: 'UPLOAD_FILTER_REJECTED' });
  }
  next();
}

function resolveTenantId(req) {
  const paramId = req.params.id || req.params.tenantId;
  return clientService.resolveCanonicalClientId(paramId);
}

// GET /api/tenants/:id/templates - List all versions and active template
router.get(['/:id/templates', '/:id/template'], requireAuth, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(404).json({ error: 'Customer identifier not found', code: 'TENANT_NOT_FOUND' });
    }

    // Role check: Client users can only query their assigned tenant
    const isAdmin = req.user?.role === 'admin';
    const userAssigned = clientService.resolveCanonicalClientId(req.user?.assignedClient);
    if (!isAdmin && userAssigned && userAssigned !== tenantId) {
      return res.status(403).json({
        error: 'Forbidden: Access to this customer templates is restricted.',
        code: 'TENANT_FORBIDDEN',
      });
    }

    const manifest = await templateService.getManifest(tenantId);
    const activePath = templateService.getActiveTemplatePath(tenantId);
    const isGlobalFallback = activePath.includes('master_template.pptx');

    return res.json({
      success: true,
      tenantId,
      activeVersionId: manifest.activeVersionId,
      isGlobalFallback,
      versions: manifest.versions || [],
      updatedAt: manifest.updatedAt,
    });
  } catch (err) {
    console.error('[templateRoutes] Error listing templates:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// POST /api/tenants/:id/templates - Upload new template version (Admin only)
router.post(
  ['/:id/templates', '/:id/template'],
  requireAuth,
  requireAdmin,
  templateUpload.single('template'),
  handleTemplateUploadErrors,
  async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Customer identifier not found', code: 'TENANT_NOT_FOUND' });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'PowerPoint (.pptx) template file is required', code: 'MISSING_FILE' });
      }

      const fileBuffer = req.file.buffer;
      templateService.validatePptxMagicBytes(fileBuffer);
      const originalName = req.file.originalname || 'template.pptx';
      const uploadedBy = req.user?.email || req.user?.username || 'Admin User';

      const version = await templateService.createVersion(tenantId, fileBuffer, originalName, uploadedBy);

      return res.status(201).json({
        success: true,
        message: 'Template version created successfully.',
        tenantId,
        version,
      });
    } catch (err) {
      console.error('[templateRoutes] Error uploading template:', err);
      return res.status(400).json({ error: err.message || 'Template upload failed', code: 'UPLOAD_FAILED' });
    }
  }
);

// POST /api/tenants/:id/templates/:versionId/activate - Activate an existing version (Admin only)
router.post('/:id/templates/:versionId/activate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { versionId } = req.params;

    if (!tenantId) {
      return res.status(404).json({ error: 'Customer identifier not found', code: 'TENANT_NOT_FOUND' });
    }

    const manifest = await templateService.activateVersion(tenantId, versionId);
    return res.json({
      success: true,
      message: `Template version ${versionId} activated successfully.`,
      tenantId,
      activeVersionId: manifest.activeVersionId,
      manifest,
    });
  } catch (err) {
    console.error('[templateRoutes] Error activating template version:', err);
    return res.status(400).json({ error: err.message, code: 'ACTIVATION_FAILED' });
  }
});

// DELETE /api/tenants/:id/templates/:versionId - Delete an inactive version (Admin only)
router.delete('/:id/templates/:versionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { versionId } = req.params;

    if (!tenantId) {
      return res.status(404).json({ error: 'Customer identifier not found', code: 'TENANT_NOT_FOUND' });
    }

    const result = await templateService.deleteVersion(tenantId, versionId);
    return res.json({
      success: true,
      message: `Template version ${versionId} deleted successfully.`,
      deletedVersionId: result.deletedVersionId,
    });
  } catch (err) {
    console.error('[templateRoutes] Error deleting template version:', err);
    return res.status(400).json({ error: err.message, code: 'DELETE_FAILED' });
  }
});

// GET /api/tenants/:id/templates/:versionId/download - Download template version file
router.get('/:id/templates/:versionId/download', requireAuth, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { versionId } = req.params;

    if (!tenantId) {
      return res.status(404).json({ error: 'Customer identifier not found', code: 'TENANT_NOT_FOUND' });
    }

    const manifest = await templateService.getManifest(tenantId);
    const version = (manifest.versions || []).find((v) => v.versionId === versionId);

    if (!version) {
      return res.status(404).json({ error: 'Template version not found', code: 'VERSION_NOT_FOUND' });
    }

    const { versionsDir, templatesDir } = templateService.getTenantTemplatesDir(tenantId);

    // Stream from database storage (Sub-Item #2.3 Cutover)
    if (process.env.STORAGE_BACKEND !== 'disk') {
      const storageRepo = require('../repositories/storageRepo');
      const key = `tenants/${tenantId}/templates/${version.storedName}`;
      const stored = await storageRepo.getObject({ tenantId, key });
      if (stored) {
        return storageRepo.streamObjectToResponse({
          tenantId,
          key,
          req,
          res,
          filename: version.filename,
        });
      }
    }

    let versionPath = path.join(versionsDir, version.storedName);
    if (!fs.existsSync(versionPath)) {
      const candidates = [
        path.join(templatesDir, version.storedName),
        path.join(templatesDir, 'master.pptx'),
        version.storagePath ? path.resolve(__dirname, '../../', version.storagePath) : null,
      ].filter(Boolean);
      const found = candidates.find((p) => fs.existsSync(p));
      if (found) {
        versionPath = found;
      } else {
        return res.status(404).json({ error: 'Template version physical file missing', code: 'FILE_NOT_FOUND' });
      }
    }

    return res.download(versionPath, version.filename);
  } catch (err) {
    console.error('[templateRoutes] Error downloading template version:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

module.exports = router;
