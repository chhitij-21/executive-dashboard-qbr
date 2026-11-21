# Implementation Plan: Item #5 Upload Hardening (Limits / Magic Bytes)

## Problem Statement
Currently, the application's file upload pipelines (`/api/upload`, `/api/inventory/sync/upload`, and `/api/reports/:clientId/tickets/upload`) rely solely on user-supplied file extensions (`.xlsx`, `.xls`, `.csv`) and basic HTTP `Content-Type` headers. This leaves the system vulnerable to extension spoofing, where an attacker or user uploads executable binaries, arbitrary scripts, or HTML files renamed with `.xlsx` or `.csv` extensions. Furthermore, the multer instances lack fine-grained multipart limits (e.g., field count, field size, file count), and multer errors (such as file size limit breaches) can leak internal stack traces or produce unhandled errors rather than clean, standardized JSON security responses.

---

## Files to Touch
1. **`backend/middleware/uploadHardening.js`** (NEW FILE):
   - Implement binary magic byte signature verification for spreadsheets:
     - OpenXML / XLSX (ZIP archive signatures: `PK\x03\x04` [`0x50, 0x4B, 0x03, 0x04`], `PK\x05\x06`, `PK\x07\x08`).
     - Legacy Excel / XLS (Compound File Binary Format: `\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1`).
     - CSV: Plain text validation ensuring no binary null bytes (`0x00`) exist in the initial 4KB, while properly handling optional UTF-8 BOM (`\xEF\xBB\xBF`).
     - Explicit blacklist for dangerous executable headers (PE/MZ `4D 5A`, ELF `7F 45 4C 46`, Mach-O, scripts).
   - Configure hardened Multer limit presets:
     - `fileSize`: 30 MB (reduced from 50 MB to prevent memory exhaustion).
     - `files`: max 2 files (incidents + inventory).
     - `fields`: max 20 fields.
     - `parts`: max 30 parts.
     - `fieldSize`: max 1 MB.
   - Implement `verifyUploadedFileSignatures` middleware supporting both disk-based (`file.path`) and memory-based (`file.buffer`) uploads with automatic temp file cleanup on rejection.
   - Implement `handleUploadErrors` middleware converting Multer errors (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_UNEXPECTED_FILE`) into clean, consistent HTTP 400 responses.

2. **`backend/index.js`** (Lines 224–250, 967–974, and error handler):
   - Replace the raw multer instance with the hardened multer instance and limits.
   - Insert `verifyUploadedFileSignatures` and `handleUploadErrors` into `app.post(['/api/upload', '/upload'])`.

3. **`backend/routes/reports.js`** (Lines 14–35):
   - Apply hardened limits and `verifyUploadedFileSignatures` to `POST /:clientId/tickets/upload`.

4. **`backend/routes/inventorySync.js`** (Lines 26–36):
   - Apply hardened limits and `verifyUploadedFileSignatures` to `POST /sync/upload`.

5. **`backend/tests/uploadHardening.test.js`** (NEW TEST SUITE):
   - Comprehensive unit and integration tests verifying magic bytes, spoof rejection, size limits, and clean error codes.

---

## Data Flow & Control Flow Changes
1. **Client sends `multipart/form-data`**:
   `Request` $\rightarrow$ `Hardened Multer` checks multipart limits (max 30MB, max 2 files).
   - If limits exceeded $\rightarrow$ `handleUploadErrors` catches `MulterError` and returns `400 Bad Request` (`FILE_SIZE_LIMIT_EXCEEDED`).
2. **Pre-processing Magic Bytes Inspection**:
   - `verifyUploadedFileSignatures` executes before any parser or business logic.
   - Inspects the first 8–512 bytes of each uploaded file (from buffer or via `fs.openSync` / `fs.readSync`).
   - If extension is `.xlsx` but magic bytes $\neq$ `PK..` $\rightarrow$ unlinks temp file immediately, logs security notice, and returns `400 Bad Request` with `{ error: 'Invalid file signature', code: 'INVALID_FILE_SIGNATURE' }`.
   - If extension is `.csv` but contains binary nulls or executable headers $\rightarrow$ unlinks temp file and returns `400 Bad Request`.
3. **Execution**:
   - Only verified, legitimate spreadsheet files proceed to `processData.js` or `reportUpload.js`.

---

## Risks and Edge Cases
- **Legitimate XLSX with differing ZIP headers**:
  - OpenXML documents use PKZip format which can begin with `PK\x03\x04` (standard local file header), or rarely `PK\x05\x06` / `PK\x07\x08`. Validator accepts all valid PKZip signatures.
- **CSV Encoded with BOM**:
  - Windows Excel exports CSV with a 3-byte UTF-8 BOM (`EF BB BF`). The validator recognizes and strips BOM before text inspection.
- **Disk File Cleanup**:
  - If a file is rejected during signature verification, `fs.unlinkSync` is called immediately so orphaned invalid files never accumulate in `uploads/incoming` or `os.tmpdir()`.
- **Backward Compatibility**:
  - Valid real-world Excel workbooks from JFL and MMTC will pass seamlessly with zero friction.

---

## Test Cases to Add / Update
1. `validateFileMagicBytes` accepts genuine OpenXML XLSX (PK header).
2. `validateFileMagicBytes` accepts genuine Compound XLS header.
3. `validateFileMagicBytes` accepts valid UTF-8 CSV with and without BOM.
4. `validateFileMagicBytes` rejects spoofed file (e.g. text file or JSON renamed to `spreadsheet.xlsx`).
5. `validateFileMagicBytes` rejects Windows executable (`MZ`) renamed to `incident.xlsx`.
6. `validateFileMagicBytes` rejects binary file with null bytes renamed to `incident.csv`.
7. `POST /api/upload` returns 400 `INVALID_FILE_SIGNATURE` when an invalid file is uploaded.
8. `POST /api/upload` returns 400 `LIMIT_FILE_SIZE` when file exceeds 30MB limit.
9. All 226 existing backend, AI, and frontend tests continue to pass (100% green).

---

## Rollback Plan
- Run `git checkout backend/index.js backend/routes/reports.js backend/routes/inventorySync.js`.
- Remove `backend/middleware/uploadHardening.js` and `backend/tests/uploadHardening.test.js`.
