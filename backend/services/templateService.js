// backend/services/templateService.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  const manifestPath = getManifestPath(tenantId);
  if (!fs.existsSync(manifestPath)) {
    return {
      tenantId,
      activeVersionId: null,
      updatedAt: new Date().toISOString(),
      versions: [],
    };
  }
  try {
    const content = await fs.promises.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[templateService] Corrupt manifest for ${tenantId}, initializing fresh:`, err.message);
    return {
      tenantId,
      activeVersionId: null,
      updatedAt: new Date().toISOString(),
      versions: [],
    };
  }
}

async function saveManifest(tenantId, manifest) {
  const manifestPath = getManifestPath(tenantId);
  const tmpPath = `${manifestPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  manifest.updatedAt = new Date().toISOString();
  const payload = JSON.stringify(manifest, null, 2);
  await fs.promises.writeFile(tmpPath, payload, 'utf8');
  try {
    await fs.promises.rename(tmpPath, manifestPath);
  } catch (_) {
    await fs.promises.copyFile(tmpPath, manifestPath);
    await fs.promises.unlink(tmpPath).catch(() => {});
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

async function enforceRetentionPolicy(manifest, versionsDir) {
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
    filename: path.basename(originalFilename || `${versionId}.pptx`),
    storedName,
    sizeBytes: buffer.length,
    sha256,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    isActive: true,
  };

  manifest.versions.push(newVersionEntry);
  manifest.activeVersionId = versionId;

  await enforceRetentionPolicy(manifest, versionsDir);

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

  for (const v of manifest.versions) {
    v.isActive = (v.versionId === versionId);
  }
  manifest.activeVersionId = versionId;

  const versionPath = path.join(versionsDir, target.storedName);
  if (fs.existsSync(versionPath)) {
    const masterPath = path.join(templatesDir, 'master.pptx');
    await fs.promises.copyFile(versionPath, masterPath).catch(() => {});
  }

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

