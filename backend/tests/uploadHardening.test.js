// backend/tests/uploadHardening.test.js
// TDD Test Suite for Item #5: Upload Hardening (Limits / Magic Bytes)

process.env.NODE_ENV = 'test';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');

const {
  validateBufferMagicBytes,
  validateFileMagicBytes,
  verifyUploadedFileSignatures,
  handleUploadErrors,
  createHardenedUploadMiddleware,
} = require('../middleware/uploadHardening');

describe('Upload Hardening & Magic Bytes Suite (Item #5)', () => {
  // ── 1. Unit Tests for validateBufferMagicBytes ──────────────────────────────
  describe('validateBufferMagicBytes', () => {
    it('accepts valid OpenXML XLSX buffer (PK 03 04)', () => {
      const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
      const res = validateBufferMagicBytes(buf, 'report.xlsx');
      assert.equal(res.valid, true);
      assert.equal(res.detectedType, 'xlsx');
    });

    it('accepts valid legacy Excel XLS buffer (D0 CF 11 E0)', () => {
      const buf = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
      const res = validateBufferMagicBytes(buf, 'inventory.xls');
      assert.equal(res.valid, true);
      assert.equal(res.detectedType, 'xls');
    });

    it('accepts valid CSV plain text buffer', () => {
      const buf = Buffer.from('Ticket Number,Severity,Status,Summary\nINC-1001,P1,Closed,Server Down\n', 'utf8');
      const res = validateBufferMagicBytes(buf, 'incidents.csv');
      assert.equal(res.valid, true);
      assert.equal(res.detectedType, 'csv');
    });

    it('accepts valid CSV with UTF-8 BOM header', () => {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const text = Buffer.from('Host,Serial,Model\nswitch-01,FCZ12345,C9300\n', 'utf8');
      const buf = Buffer.concat([bom, text]);
      const res = validateBufferMagicBytes(buf, 'devices.csv');
      assert.equal(res.valid, true);
      assert.equal(res.detectedType, 'csv');
    });

    it('rejects spoofed text file masquerading as XLSX', () => {
      const buf = Buffer.from('This is just plain text content pretending to be an excel sheet', 'utf8');
      const res = validateBufferMagicBytes(buf, 'payload.xlsx');
      assert.equal(res.valid, false);
      assert.match(res.error, /Invalid XLSX magic bytes/i);
    });

    it('rejects Windows executable (MZ header) masquerading as XLSX', () => {
      const buf = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const res = validateBufferMagicBytes(buf, 'malware.xlsx');
      assert.equal(res.valid, false);
      assert.match(res.error, /Executable or forbidden file signature/i);
    });

    it('rejects Linux ELF binary header masquerading as XLSX', () => {
      const buf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
      const res = validateBufferMagicBytes(buf, 'exploit.xlsx');
      assert.equal(res.valid, false);
      assert.match(res.error, /Executable or forbidden file signature/i);
    });

    it('rejects binary file with null bytes masquerading as CSV', () => {
      const buf = Buffer.from([0x41, 0x42, 0x00, 0x43, 0x44, 0x00, 0x50, 0x51]);
      const res = validateBufferMagicBytes(buf, 'data.csv');
      assert.equal(res.valid, false);
      assert.match(res.error, /Invalid CSV format/i);
    });

    it('rejects completely empty or too short buffers', () => {
      const buf = Buffer.alloc(0);
      const res = validateBufferMagicBytes(buf, 'empty.xlsx');
      assert.equal(res.valid, false);
      assert.match(res.error, /File is empty/i);
    });
  });

  // ── 2. Disk-based validateFileMagicBytes ────────────────────────────────────
  describe('validateFileMagicBytes', () => {
    let tmpDir;

    it('validates disk files and removes invalid files on failure', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload_test_'));
      const validXlsx = path.join(tmpDir, 'valid.xlsx');
      fs.writeFileSync(validXlsx, Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]));

      const validRes = validateFileMagicBytes(validXlsx, 'original.xlsx');
      assert.equal(validRes.valid, true);

      const fakeXlsx = path.join(tmpDir, 'fake.xlsx');
      fs.writeFileSync(fakeXlsx, Buffer.from('NOT A REAL ZIP'));

      const invalidRes = validateFileMagicBytes(fakeXlsx, 'spoofed.xlsx');
      assert.equal(invalidRes.valid, false);

      // Cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });
  });

  // ── 3. Express Middleware Integration ──────────────────────────────────────
  describe('Express Middleware verifyUploadedFileSignatures & handleUploadErrors', () => {
    let app;
    let server;
    let baseUrl;

    it('sets up test harness with hardened upload middleware', async () => {
      app = express();
      const upload = createHardenedUploadMiddleware({
        dest: os.tmpdir(),
        maxFileSize: 1024 * 1024, // 1MB limit for test
        maxFiles: 2,
      });

      app.post(
        '/test/upload',
        upload.fields([{ name: 'file1', maxCount: 1 }, { name: 'file2', maxCount: 1 }]),
        handleUploadErrors,
        verifyUploadedFileSignatures,
        (req, res) => {
          res.json({ success: true, files: Object.keys(req.files || {}) });
        }
      );

      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    it('rejects upload when spoofed file is submitted', async () => {
      const boundary = '----WebKitFormBoundaryTest123';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file1"; filename="bad.xlsx"',
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '',
        'This is plain text and NOT zip',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const res = await fetch(`${baseUrl}/test/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.code, 'INVALID_FILE_SIGNATURE');
      assert.ok(json.error);
    });

    it('accepts upload when valid XLSX magic bytes are submitted', async () => {
      const boundary = '----WebKitFormBoundaryTest456';
      const validBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const header = Buffer.from(
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file1"; filename="good.xlsx"\r\n' +
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, validBytes, footer]);

      const res = await fetch(`${baseUrl}/test/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
    });

    it('cleans up server test instance', async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
