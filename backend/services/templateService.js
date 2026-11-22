// backend/services/templateService.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const templateRepo = require('../repositories/templateRepo');
const clientService = require('./clientService');

const MAX_TEMPLATE_VERSIONS = 5;

/**
 * Validates PK zip magic bytes (50 4B 03 04) to ensure only valid OpenXML PPTX files are accepted.
 */
function validatePptxMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error('Invalid file signature: file is empty or too small to be a PPTX.');
  }
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (!isZip) {
    throw new Error('Invalid file signature: magic bytes do not match PowerPoint PPTX format.');
  }
}

function getTenantTemplatesDir(tenantId) {
  const canonicalId = clientService.resolveCanonicalClientId(tenantId) || 'client-default';
  const tenantDir = path.resolve(__dirname, '../../data/tenants', canonicalId);
  const templatesDir = path.join(tenantDir, 'templates');
  const versionsDir = path.join(templatesDir, 'versions');
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }
  return { tenantDir, templatesDir, versionsDir, canonicalId };
}

function getManifestPath(tenantId) {
  const { templatesDir } = getTenantTemplatesDir(tenantId);
  return path.join(templatesDir, 'templates_manifest.json');
}

async function getManifest(tenantId) {
  const { canonicalId } = getTenantTemplatesDir(tenantId);
  try {
    const dbManifest = await templateRepo.getManifest(canonicalId);
    if (dbManifest && dbManifest.versions && dbManifest.versions.length > 0) {
      return {
        tenantId: canonicalId,
        activeVersion: dbManifest.activeVersion,
        activeVersionId: `v${dbManifest.activeVersion}`,
        updatedAt: new Date().toISOString(),
        versions: dbManifest.versions.map((v) => ({
          versionId: `v${v.version}`,
          version: v.version,
          originalName: v.filename,
          storedName: path.basename(v.storagePath),
          size: v.fileSizeBytes,
          uploadedAt: v.uploadedAt,
          uploadedBy: v.uploadedBy,
          isActive: v.isActive,
        })),
      };
    }
  } catch (_) {}

  const manifestPath = getManifestPath(tenantId);
  if (!fs.existsSync(manifestPath)) {
    return {
      tenantId: canonicalId,
      activeVersion: 1,
      activeVersionId: null,
      updatedAt: new Date().toISOString(),
      versions: [],
    };
  }
  try {
    const content = await fs.promises.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      activeVersion: parsed.activeVersion || (parsed.activeVersionId ? parseInt(parsed.activeVersionId.replace('v', ''), 10) : 1),
      ...parsed,
    };
  } catch (err) {
    console.warn(`[templateService] Corrupt manifest for ${tenantId}, initializing fresh:`, err.message);
    return {
      tenantId: canonicalId,
      activeVersion: 1,
      activeVersionId: null,
      updatedAt: new Date().toISOString(),
      versions: [],
    };
  }
}

async function saveManifest(tenantId, manifest) {
  const { canonicalId } = getTenantTemplatesDir(tenantId);

  // Sync to DB repo (Item #3)
  try {
    if (Array.isArray(manifest.versions)) {
      const activeNum = manifest.activeVersion || parseInt(String(manifest.activeVersionId || '').replace(/\D/g, ''), 10) || 1;
      for (const v of manifest.versions) {
        const vNum = typeof v.version === 'number' ? v.version : parseInt(String(v.versionId || '').replace(/\D/g, ''), 10) || 1;
        const isActive = (v.versionId === manifest.activeVersionId || vNum === activeNum);
        await templateRepo.addVersion({
          id: `${canonicalId}_v${vNum}`,
          tenantId: canonicalId,
          version: vNum,
          filename: v.originalName || v.filename || `template_v${vNum}.pptx`,
          storagePath: v.storagePath || path.join('data', 'tenants', canonicalId, 'templates', 'versions', v.storedName || `v${vNum}.pptx`),
          fileSizeBytes: v.size || v.fileSizeBytes || 0,
          uploadedBy: v.uploadedBy || 'admin@portal.com',
          uploadedAt: v.uploadedAt || new Date().toISOString(),
          isActive,
        });
      }
    }
  } catch (_) {}

  const manifestPath = getManifestPath(tenantId);
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const tmpPath = `${manifestPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  manifest.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(manifest, null, 2);
  await fs.promises.writeFile(tmpPath, payload, 'utf8');
  try {
    await fs.promises.rename(tmpPath, manifestPath);
  } catch (_) {
    try {
      await fs.promises.copyFile(tmpPath, manifestPath);
      await fs.promises.unlink(tmpPath).catch(() => {});
    } catch (__e) {
      await fs.promises.writeFile(manifestPath, payload, 'utf8');
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }
}

function getGlobalFallbackTemplatePath() {
  const candidates = [
    path.resolve(__dirname, '../../templates/master_template.pptx'),
    path.resolve(__dirname, '../../../templates/master_template.pptx'),
    path.resolve('templates/master_template.pptx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getActiveTemplatePath(tenantId) {
  const globalFallback = getGlobalFallbackTemplatePath();
  if (!tenantId) return globalFallback;

  const canonicalId = clientService.resolveCanonicalClientId(tenantId);
  const tenantDir = path.resolve(__dirname, '../../data/tenants', canonicalId || tenantId);
  const templatesDir = path.join(tenantDir, 'templates');
  const manifestPath = path.join(templatesDir, 'templates_manifest.json');

  if (!fs.existsSync(manifestPath)) {
    const legacyMaster = path.join(templatesDir, 'master.pptx');
    if (fs.existsSync(legacyMaster) && fs.statSync(legacyMaster).size > 0) {
      return legacyMaster;
    }
    return globalFallback;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.activeVersionId) return globalFallback;

    const activeVersion = (manifest.versions || []).find((v) => v.versionId === manifest.activeVersionId);
    if (!activeVersion || !activeVersion.storedName) return globalFallback;

    const versionFilePath = path.join(templatesDir, 'versions', activeVersion.storedName);
    if (fs.existsSync(versionFilePath) && fs.statSync(versionFilePath).size > 0) {
      return versionFilePath;
    }
  } catch (err) {
    console.warn(`[templateService] Notice resolving template for ${tenantId}:`, err.message);
  }

  return globalFallback;
}

async function enforceRetentionPolicy(manifest, versionsDir, canonicalId) {
  if (manifest.versions.length <= MAX_TEMPLATE_VERSIONS) return;

  const sorted = [...manifest.versions].sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));

  while (sorted.length > MAX_TEMPLATE_VERSIONS) {
    let pruneIndex = sorted.findIndex((v) => v.versionId !== manifest.activeVersionId);
    if (pruneIndex === -1) {
      pruneIndex = 0;
    }
    const [pruned] = sorted.splice(pruneIndex, 1);
    if (pruned) {
      const prunePath = path.join(versionsDir, pruned.storedName);
      await fs.promises.unlink(prunePath).catch(() => {});
      manifest.versions = manifest.versions.filter((v) => v.versionId !== pruned.versionId);
      try {
        const vNum = typeof pruned.version === 'number' ? pruned.version : parseInt(String(pruned.versionId || '').replace(/\D/g, ''), 10);
        if (canonicalId && vNum) {
          await templateRepo.deleteVersion(canonicalId, vNum);
        }
      } catch (_) {}
    }
  }
}

async function createVersion(tenantId, buffer, originalFilename, uploadedBy = 'System User') {
  validatePptxMagicBytes(buffer);

  const { templatesDir, versionsDir, canonicalId } = getTenantTemplatesDir(tenantId);
  const manifest = await getManifest(canonicalId);

  const versionNum = (manifest.versions.length > 0)
    ? (Math.max(...manifest.versions.map((v) => parseInt(String(v.versionId).replace(/\D/g, ''), 10) || 0)) + 1)
    : 1;
  const versionId = `v${versionNum}`;
  const storedName = `${versionId}_${Date.now()}.pptx`;
  const filePath = path.join(versionsDir, storedName);

  await fs.promises.writeFile(filePath, buffer);

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  for (const v of manifest.versions) {
    v.isActive = false;
  }

  const newVersionEntry = {
    versionId,
    version: versionNum,
    filename: path.basename(originalFilename || `${versionId}.pptx`),
    storedName,
    storagePath: path.join('data', 'tenants', canonicalId, 'templates', 'versions', storedName),
    sizeBytes: buffer.length,
    sha256,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    isActive: true,
  };

  manifest.versions.push(newVersionEntry);
  manifest.activeVersion = versionNum;
  manifest.activeVersionId = versionId;

  await enforceRetentionPolicy(manifest, versionsDir, canonicalId);

  const masterPath = path.join(templatesDir, 'master.pptx');
  try {
    await fs.promises.copyFile(filePath, masterPath);
  } catch (_) {}

  await saveManifest(canonicalId, manifest);

  return newVersionEntry;
}

async function activateVersion(tenantId, versionId) {
  const { templatesDir, versionsDir, canonicalId } = getTenantTemplatesDir(tenantId);
  const manifest = await getManifest(canonicalId);

  const target = manifest.versions.find((v) => v.versionId === versionId);
  if (!target) {
    throw new Error(`Version not found: "${versionId}" for tenant ${canonicalId}`);
  }

  const vNum = typeof target.version === 'number' ? target.version : parseInt(String(target.versionId || '').replace(/\D/g, ''), 10) || 1;
  manifest.activeVersion = vNum;
  manifest.activeVersionId = versionId;

  for (const v of manifest.versions) {
    v.isActive = (v.versionId === versionId);
  }

  const versionPath = path.join(versionsDir, target.storedName);
  if (fs.existsSync(versionPath)) {
    const masterPath = path.join(templatesDir, 'master.pptx');
    await fs.promises.copyFile(versionPath, masterPath).catch(() => {});
  }

  try {
    await templateRepo.setActiveVersion(canonicalId, vNum);
  } catch (_) {}

  await saveManifest(canonicalId, manifest);
  return manifest;
}

async function deleteVersion(tenantId, versionId) {
  const { versionsDir, canonicalId } = getTenantTemplatesDir(tenantId);
  const manifest = await getManifest(canonicalId);

  const target = manifest.versions.find((v) => v.versionId === versionId);
  if (!target) {
    throw new Error(`Version not found: "${versionId}" for tenant ${canonicalId}`);
  }

  if (manifest.activeVersionId === versionId) {
    throw new Error('Cannot delete active template version. Please activate another version first.');
  }

  const filePath = path.join(versionsDir, target.storedName);
  await fs.promises.unlink(filePath).catch(() => {});

  manifest.versions = manifest.versions.filter((v) => v.versionId !== versionId);
  try {
    const vNum = typeof target.version === 'number' ? target.version : parseInt(String(target.versionId || '').replace(/\D/g, ''), 10);
    if (vNum) {
      await templateRepo.deleteVersion(canonicalId, vNum);
    }
  } catch (_) {}
  await saveManifest(canonicalId, manifest);

  return { success: true, deletedVersionId: versionId };
}

module.exports = {
  getManifest,
  getActiveTemplatePath,
  createVersion,
  activateVersion,
  deleteVersion,
  validatePptxMagicBytes,
  MAX_TEMPLATE_VERSIONS,
};

