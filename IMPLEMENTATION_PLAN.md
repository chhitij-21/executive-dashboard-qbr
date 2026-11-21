# Implementation Plan: Item #11 Template Versioning (Option A: Filesystem Manifest & Versioned Storage)

## 1. Problem Statement
Currently, each tenant only supports a single PPTX template (`data/tenants/{tenantId}/templates/master.pptx`), which overwrites the previous template upon upload. There is no historical version tracking, no ability to audit which template version generated a past QBR deck, no rollback capability when a corrupted or misaligned branding deck is uploaded, and no safeguards against disk space exhaustion from unbounded uploads. 

Item #11 implements **Option A: Filesystem Manifest & Versioned Storage** with strict security, retention, and fallback guarantees. Each tenant's template history will be managed via `data/tenants/{tenantId}/templates/templates_manifest.json` pointing to versioned artifacts (`versions/{versionId}.pptx`), supporting atomic activation, 1-click rollback, and zero regressions for existing multi-tenant and global template flows.

---

## 2. Architecture & File Storage Model

### A. Tenant Directory Structure
```text
data/tenants/{tenantId}/templates/
├── templates_manifest.json         <-- SSOT metadata manifest
├── master.pptx                     <-- Symlink or atomic copy of active version (backward compatibility)
└── versions/
    ├── v1_1763784000.pptx          <-- Versioned presentation template
    ├── v2_1763787600.pptx
    └── v3_1763791200.pptx
```

### B. Template Manifest Schema (`templates_manifest.json`)
```json
{
  "tenantId": "client-jfl",
  "activeVersionId": "v2",
  "updatedAt": "2026-11-22T01:15:00.000Z",
  "versions": [
    {
      "versionId": "v1",
      "filename": "JFL_QBR_Master_Q1.pptx",
      "storedName": "v1_1763784000.pptx",
      "sizeBytes": 2451000,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "uploadedBy": "admin@portal.com",
      "uploadedAt": "2026-11-20T10:00:00.000Z",
      "isActive": false
    },
    {
      "versionId": "v2",
      "filename": "JFL_QBR_Master_Q2_Branded.pptx",
      "storedName": "v2_1763787600.pptx",
      "sizeBytes": 2580120,
      "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      "uploadedBy": "admin@portal.com",
      "uploadedAt": "2026-11-22T01:15:00.000Z",
      "isActive": true
    }
  ]
}
```

---

## 3. Mandatory Safeguards

### Safeguard 1: Template Upload Security (Item #5 Magic Byte Validation)
- Upload endpoint `POST /api/tenants/:id/templates` must be gated by:
  - `requireAuth` + `requireAdmin` (only authorized administrators can upload branding templates).
  - `verifyUploadedFileSignatures` middleware enforcing strict magic bytes (`PK\x03\x04` ZIP archive signature for OpenXML `.pptx` documents).
  - Explicit mime-type and extension validation (`.pptx` only, rejecting `.exe`, `.sh`, `.php`, `.pdf`, `.xls`, or renamed binaries).
  - Corrupt or invalid files are cleaned up immediately from temp storage before manifest modification.

### Safeguard 2: Global Template Fallback
- `templateService.getActiveTemplatePath(tenantId)` and `clientService.getTenantTemplatePath(tenantId)`:
  - Step 1: Check if tenant directory and `templates_manifest.json` exist.
  - Step 2: Read manifest and resolve `activeVersionId`.
  - Step 3: Check if the versioned file (`versions/{storedName}`) exists on disk and is non-empty.
  - Step 4: If manifest is missing, corrupt, has no active version, or the file was deleted: **FALLBACK SAFELY** to global `templates/master_template.pptx`.
  - Step 5: If global template is accessed, log an audit warning without throwing errors. The report pipeline and PPT generator must **NEVER crash or produce a blank PPT**.

### Safeguard 3: Version Retention Policy (Max 5 Versions)
- To prevent unbounded disk space consumption, each tenant is restricted to **at most 5 template versions**:
  - When an upload requests adding a new version and the count reaches 6:
    - Sort existing versions by `uploadedAt` ascending.
    - Filter candidates for deletion (ensuring active version is protected if user uploaded an inactive draft).
    - If the oldest version is not the current active version, delete its `.pptx` file from `versions/`.
    - If the oldest version happens to be the active version, designate the newest version as active before deleting the oldest.
    - Remove the deleted entry from `templates_manifest.json`.
    - Write manifest atomically via `.tmp` and `fs.renameSync`.

### Safeguard 4: Admin-Only RBAC Enforcement
- Strict Role-Based Access Control on template modification:
  - `POST /api/tenants/:id/templates` (Upload): Restricted to `role === 'admin'`. Non-admin client users (e.g., JFL/MMTC users) receive HTTP 403 Forbidden (`{ error: 'Forbidden: Admin access required to manage presentation templates.', code: 'ADMIN_ACCESS_REQUIRED' }`).
  - `POST /api/tenants/:id/templates/:versionId/activate` (Activate): Restricted to `role === 'admin'`. Non-admin client users receive HTTP 403 Forbidden.
  - `DELETE /api/tenants/:id/templates/:versionId` (Delete): Restricted to `role === 'admin'`. Non-admin client users receive HTTP 403 Forbidden.
  - `GET /api/tenants/:id/templates` (List): Read-only access allowed for client users belonging to the tenant and admins to inspect available branding decks.

---

## 4. API Endpoint Contract

| Method | Endpoint | Auth & RBAC | Description |
|---|---|---|---|
| `GET` | `/api/tenants/:id/templates` | `requireAuth` | Returns list of all template versions, active version ID, and fallback status (Admin + Tenant users) |
| `POST` | `/api/tenants/:id/templates` | `requireAuth, requireAdmin` | Uploads new `.pptx` template version with magic-byte validation and max-5 retention (Admin only, 403 for Client) |
| `POST` | `/api/tenants/:id/templates/:versionId/activate` | `requireAuth, requireAdmin` | Activates an existing version ID for subsequent QBR generation (Admin only, 403 for Client) |
| `DELETE` | `/api/tenants/:id/templates/:versionId` | `requireAuth, requireAdmin` | Deletes an inactive template version and its physical `.pptx` file (Admin only, 403 for Client) |
| `GET` | `/api/tenants/:id/templates/:versionId/download` | `requireAuth` | Securely downloads a template version for inspection or local editing |

*Backward Compatibility Note*: Legacy routes `POST /api/tenants/:id/template` and `POST /api/clients/:id/template` will invoke `templateService.createVersion` under the hood and update `master.pptx` for seamless compatibility with existing client scripts.

---

## 5. Files to Touch

1. **`backend/services/templateService.js` (NEW)**:
   - Encapsulates manifest reading/writing, version hashing (SHA-256), atomic write (`.tmp` -> `rename`), max-5 retention cleanup, activation, and deletion.
2. **`backend/services/clientService.js`**:
   - Update `getTenantTemplatePath(tenantId)` (lines 280–288) to query `templateService.getActiveTemplatePath(tenantId)`.
3. **`backend/routes/templateRoutes.js` (NEW)**:
   - Express router implementing version listing, upload with magic-byte validation, activation, download, and deletion.
4. **`backend/index.js`**:
   - Mount `/api/tenants/:id/templates` router.
   - Wire legacy `/api/tenants/:id/template` handler to create a version in `templateService`.
5. **`frontend/src/components/ClientManager.jsx`**:
   - Add "Template Versions" management modal/section allowing admins to upload new versions, view historical timestamps, download templates, and switch active versions with 1 click.
6. **`backend/tests/templateVersioning.test.js` (NEW)**:
   - Comprehensive test suite verifying magic byte security, 5-version retention policy, global fallback, and atomic activation.

---

## 6. Risks & Edge Cases

| Risk / Edge Case | Mitigation |
|---|---|
| Uploaded template has valid extension but contains executable payload | Enforce `verifyUploadedFileSignatures` magic byte check (`PK\x03\x04`) before file is accepted. |
| Tenant has 0 custom templates | Seamlessly fallback to `templates/master_template.pptx`. System never fails or generates blank slides. |
| Server crashes while writing `templates_manifest.json` | Write manifest to `templates_manifest.json.tmp` first, then atomically rename via `fs.renameSync`. |
| Admin attempts to delete currently active version | Backend returns HTTP 400 Bad Request: "Cannot delete active template version. Please activate another version first." |
| Exceeding max 5 retention | Automatically purge the oldest inactive version from filesystem and manifest upon 6th upload. |
| Legacy code or direct file access expects `templates/master.pptx` | Maintain an atomic copy of active template as `templates/master.pptx` whenever active version changes. |

---

## 7. Test Plan & Invariants

- **Test Suite (`backend/tests/templateVersioning.test.js`)**:
  1. Magic Byte Validation: Reject corrupt or spoofed executable masquerading as `.pptx`.
  2. Version Creation: Successfully creates `v1` and initializes `templates_manifest.json`.
  3. Version Activation: Switching active version updates manifest and synchronizes `master.pptx`.
  4. Global Fallback: When tenant has no templates or empty manifest, returns `templates/master_template.pptx`.
  5. 5-Version Retention Policy: Uploading 6 versions results in exactly 5 versions on disk and manifest, with the oldest version purged.
  6. Delete Inactive Version: Successfully removes physical file and manifest entry; prevents deleting active version.
  7. Multi-Tenant Isolation: Tenant A cannot view or activate Tenant B's templates.
  8. Admin-Only RBAC Enforcement: Client users (e.g. JFL/MMTC) receive HTTP 403 Forbidden on upload (`POST /api/tenants/:id/templates`) and activate (`POST /api/tenants/:id/templates/:versionId/activate`), but can successfully list templates (`GET /api/tenants/:id/templates`).

- **Repo Invariants**:
  - Full repo test suite (`npm test`) passes 100% (296/296+).
  - Frontend production build (`npm --prefix frontend run build`) succeeds with 0 errors.

---

## 8. Rollback Plan
If any failure occurs, removing `backend/routes/templateRoutes.js` and restoring `clientService.js` to look for `master.pptx` restores single-template behavior without data loss.

---
**Status**: Waiting for user **APPROVED** before writing code.
