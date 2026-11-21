// backend/middleware/uploadHardening.js
// Enterprise Upload Hardening & Magic Bytes Verification Middleware (Item #5)

'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Magic byte signatures
const SIG_ZIP = [0x50, 0x4B]; // PK
const SIG_OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]; // Compound File (XLS)
const SIG_MZ = [0x4D, 0x5A]; // Windows Executable
const SIG_ELF = [0x7F, 0x45, 0x4C, 0x46]; // Linux ELF
const UTF8_BOM = [0xEF, 0xBB, 0xBF];

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);

/**
 * Validates magic bytes of an in-memory buffer.
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {{ valid: boolean, detectedType?: string, error?: string }}
 */
function validateBufferMagicBytes(buffer, filename) {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File is empty (0 bytes).' };
  }

  const ext = path.extname(filename || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Disallowed extension "${ext}". Only .xlsx, .xls, .csv allowed.` };
  }

  // Blacklist checks (Executables / Scripts)
  if (buffer.length >= 2 && buffer[0] === SIG_MZ[0] && buffer[1] === SIG_MZ[1]) {
    return { valid: false, error: 'Executable or forbidden file signature detected (MZ).' };
  }
  if (buffer.length >= 4 && buffer[0] === SIG_ELF[0] && buffer[1] === SIG_ELF[1] && buffer[2] === SIG_ELF[2] && buffer[3] === SIG_ELF[3]) {
    return { valid: false, error: 'Executable or forbidden file signature detected (ELF).' };
  }

  // XLSX (OpenXML format inside PKZip)
  if (ext === '.xlsx') {
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
      const b2 = buffer[2];
      const b3 = buffer[3];
      // PK\x03\x04 (standard) or PK\x05\x06 (empty zip) or PK\x07\x08 (spanned)
      if ((b2 === 0x03 && b3 === 0x04) || (b2 === 0x05 && b3 === 0x06) || (b2 === 0x07 && b3 === 0x08)) {
        return { valid: true, detectedType: 'xlsx' };
      }
    }
    return { valid: false, error: 'Invalid XLSX magic bytes. File does not appear to be a valid OpenXML spreadsheet.' };
  }

  // Legacy XLS (Compound File Binary Format / OLE2)
  if (ext === '.xls') {
    if (buffer.length >= 8) {
      let isOle2 = true;
      for (let i = 0; i < SIG_OLE2.length; i++) {
        if (buffer[i] !== SIG_OLE2[i]) {
          isOle2 = false;
          break;
        }
      }
      if (isOle2) {
        return { valid: true, detectedType: 'xls' };
      }
    }
    return { valid: false, error: 'Invalid XLS magic bytes. File does not appear to be a valid Excel 97-2004 spreadsheet.' };
  }

  // CSV (Text file with no binary null bytes)
  if (ext === '.csv') {
    let checkBuf = buffer;
    // Strip UTF-8 BOM if present
    if (buffer.length >= 3 && buffer[0] === UTF8_BOM[0] && buffer[1] === UTF8_BOM[1] && buffer[2] === UTF8_BOM[2]) {
      checkBuf = buffer.subarray(3);
    }
    // Check first 4096 bytes for binary nulls or non-text control characters
    const sampleLen = Math.min(checkBuf.length, 4096);
    for (let i = 0; i < sampleLen; i++) {
      const byte = checkBuf[i];
      if (byte === 0x00) {
        return { valid: false, error: 'Invalid CSV format. Binary null bytes detected.' };
      }
    }
    return { valid: true, detectedType: 'csv' };
  }

  return { valid: false, error: 'Unsupported file type.' };
}

/**
 * Validates magic bytes of a file on disk by reading header.
 * @param {string} filePath
 * @param {string} originalFilename
 * @returns {{ valid: boolean, detectedType?: string, error?: string }}
 */
function validateFileMagicBytes(filePath, originalFilename) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: 'File not found on disk.' };
  }

  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, headerBuf, 0, 512, 0);
    fs.closeSync(fd);
    fd = null;

    if (bytesRead === 0) {
      return { valid: false, error: 'File is empty (0 bytes).' };
    }

    return validateBufferMagicBytes(headerBuf.subarray(0, bytesRead), originalFilename);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    return { valid: false, error: `Error reading file header: ${err.message}` };
  }
}

/**
 * Creates a hardened Multer instance with strict multipart limits.
 */
function createHardenedUploadMiddleware(options = {}) {
  const maxFileSize = options.maxFileSize || 30 * 1024 * 1024; // 30 MB max
  const maxFiles = options.maxFiles || 2;
  const storage = options.storage || (options.dest ? multer.diskStorage({
    destination: (req, file, cb) => cb(null, options.dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.xlsx';
      cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }) : multer.memoryStorage());

  return multer({
    storage,
    limits: {
      fileSize: maxFileSize,
      files: maxFiles,
      fields: 20,
      fieldSize: 1024 * 1024, // 1 MB
      parts: 30,
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIMES.has(file.mimetype)) {
        return cb(new Error(`File type not allowed: ${file.originalname}. Only .xlsx, .xls, .csv are accepted.`));
      }
      cb(null, true);
    },
  });
}

/**
 * Express error handler middleware for Multer errors.
 */
function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    let message = 'Upload limit error';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Uploaded file exceeds the maximum allowed size of 30 MB.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded in a single request.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = `Unexpected upload field "${err.field}".`;
    }
    return res.status(400).json({
      error: message,
      code: err.code,
      details: err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      error: err.message || 'File upload rejected',
      code: 'UPLOAD_FILTER_REJECTED',
    });
  }

  next();
}

/**
 * Express middleware to verify magic bytes of all uploaded files (req.file or req.files).
 * Automatically unlinks disk files if invalid.
 */
function verifyUploadedFileSignatures(req, res, next) {
  const fileList = [];
  if (req.file) {
    fileList.push(req.file);
  } else if (req.files) {
    if (Array.isArray(req.files)) {
      fileList.push(...req.files);
    } else {
      for (const field of Object.keys(req.files)) {
        const items = req.files[field];
        if (Array.isArray(items)) {
          fileList.push(...items);
        } else if (items) {
          fileList.push(items);
        }
      }
    }
  }

  // Clean up helper
  const cleanupAll = () => {
    for (const f of fileList) {
      if (f.path && fs.existsSync(f.path)) {
        try { fs.unlinkSync(f.path); } catch (_) {}
      }
    }
  };

  for (const f of fileList) {
    let checkResult;
    if (f.buffer && Buffer.isBuffer(f.buffer)) {
      checkResult = validateBufferMagicBytes(f.buffer, f.originalname);
    } else if (f.path) {
      checkResult = validateFileMagicBytes(f.path, f.originalname);
    }

    if (checkResult && !checkResult.valid) {
      cleanupAll();
      return res.status(400).json({
        error: `Security verification failed for file "${f.originalname}": ${checkResult.error}`,
        code: 'INVALID_FILE_SIGNATURE',
        file: f.originalname,
      });
    }
  }

  next();
}

module.exports = {
  validateBufferMagicBytes,
  validateFileMagicBytes,
  createHardenedUploadMiddleware,
  handleUploadErrors,
  verifyUploadedFileSignatures,
};
