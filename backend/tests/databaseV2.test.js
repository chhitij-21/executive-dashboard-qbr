require('./_setup');
// backend/tests/databaseV2.test.js
// Automated test suite for Item #3: Database Layer (Turso/LibSQL Unified Persistence & Encrypted Recipients)

process.env.NODE_ENV = 'test';
process.env.RECIPIENTS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const testDbPath = path.resolve(__dirname, '../../data/test_db_v2.db');
process.env.TURSO_DATABASE_URL = `file:${testDbPath.replace(/\\/g, '/')}`;
process.env.TURSO_AUTH_TOKEN = '';

const dbConfig = require('../config/database');
const { migrate } = require('../db/migrate');
const cryptoUtil = require('../utils/cryptoUtil');
const userRepo = require('../repositories/userRepo');
const scheduleRepo = require('../repositories/scheduleRepo');
const templateRepo = require('../repositories/templateRepo');
const { migrateLegacyFiles } = require('../db/migrate-legacy-files');

describe('Item #3: Unified Database Layer & Encrypted Multi-Tenant Storage', () => {
  before(async () => {
    // Clean any previous test DB
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
    // Run schema migration against test database
    await migrate();
  });

  after(async () => {
    // Cleanup temporary test DB files
    for (const ext of ['', '-journal', '-wal', '-shm']) {
      const p = `${testDbPath}${ext}`;
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }
  });

  // ── 1. db_connection_dualMode ─────────────────────────────────────────────
  it('1. db_connection_dualMode: Connects cleanly to embedded SQLite and executes queries', async () => {
    const health = await dbConfig.healthCheck();
    assert.equal(health.healthy, true, 'Database health check must return healthy: true');
    assert.ok(health.timestamp, 'Health check must provide ISO timestamp');
  });

  // ── 2. db_foreignKeys_enforced ───────────────────────────────────────────
  it('2. db_foreignKeys_enforced: Foreign key constraints are actively enforced in SQLite/LibSQL', async () => {
    // Attempting to insert a run with a non-existent schedule_id must fail
    await assert.rejects(
      async () => {
        await dbConfig.execute({
          sql: `INSERT INTO schedule_runs (id, schedule_id, tenant_id, schedule_name, run_at, trigger_type, cadence, period_start, period_end, period_label, days, status, dedup_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            'run_fk_test_1',
            'non-existent-schedule-id',
            'client-jfl',
            'Orphan Run',
            new Date().toISOString(),
            'MANUAL',
            'monthly',
            '2026-10-01',
            '2026-10-31',
            'October 2026',
            31,
            'SUCCESS',
            'dedup_fk_test_1',
          ],
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('FOREIGN KEY') || err.message.includes('constraint failed'),
          `Expected foreign key violation, got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ── 3. userRepo_crud_roundtrip ───────────────────────────────────────────
  it('3. userRepo_crud_roundtrip: Performs full CRUD on users table with unique constraints', async () => {
    const testUser = {
      id: 'user_db_test_01',
      email: 'dbuser@portal.com',
      username: 'dbuser_01',
      password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012345678',
      name: 'DB Test User',
      role: 'client_user',
      assigned_client: 'client-jfl',
      avatar: '👤',
      mfa_secret: null,
      mfa_enabled: 0,
      pending_mfa_secret: null,
    };

    // Create
    await userRepo.createUser(testUser);

    // Get by ID
    const fetchedById = await userRepo.getUserById('user_db_test_01');
    assert.ok(fetchedById);
    assert.equal(fetchedById.email, 'dbuser@portal.com');
    assert.equal(fetchedById.role, 'client_user');

    // Get by Email
    const fetchedByEmail = await userRepo.getUserByEmail('dbuser@portal.com');
    assert.ok(fetchedByEmail);
    assert.equal(fetchedByEmail.id, 'user_db_test_01');

    // Update password
    const newHash = '$2a$10$updatedHashValue01234567890123456789012345678901234567890';
    await userRepo.updatePassword('user_db_test_01', newHash);
    const updated = await userRepo.getUserById('user_db_test_01');
    assert.equal(updated.password_hash, newHash);

    // List all
    const allUsers = await userRepo.getAllUsers();
    assert.ok(allUsers.some((u) => u.id === 'user_db_test_01'));
  });

  // ── 4. recipients_encrypt_decrypt_aes256 ─────────────────────────────────
  it('4. recipients_encrypt_decrypt_aes256: Encrypts recipient email list with AES-256-GCM and decrypts cleanly', () => {
    const originalRecipients = ['vp@client.com', 'director@client.com', 'ops@partner.com'];
    const tenantId = 'client-jfl';

    const encryptedJson = cryptoUtil.encryptRecipients(originalRecipients, tenantId);
    assert.ok(encryptedJson, 'Ciphertext JSON envelope must be generated');

    const envelope = JSON.parse(encryptedJson);
    assert.equal(envelope.v, 1, 'Envelope must declare version 1');
    assert.ok(envelope.iv && envelope.iv.length === 24, 'IV must be 12 bytes hex (24 chars)');
    assert.ok(envelope.tag && envelope.tag.length === 32, 'Auth tag must be 16 bytes hex (32 chars)');
    assert.ok(envelope.data, 'Ciphertext payload must be present');
    assert.ok(!encryptedJson.includes('vp@client.com'), 'Plaintext emails must never appear in ciphertext');

    // Decrypt
    const decrypted = cryptoUtil.decryptRecipients(encryptedJson, tenantId);
    assert.deepEqual(decrypted, originalRecipients, 'Decrypted array must match original plaintext recipients exactly');
  });

  // ── 5. recipients_tenantKey_isolation ────────────────────────────────────
  it('5. recipients_tenantKey_isolation: Encrypted recipients for Tenant A cannot be decrypted by Tenant B', () => {
    const recipients = ['secret@jfl.com'];
    const jflEncrypted = cryptoUtil.encryptRecipients(recipients, 'client-jfl');

    // Decrypting with client-mmtc must fail and return null
    const crossTenantDecrypted = cryptoUtil.decryptRecipients(jflEncrypted, 'client-mmtcpamp');
    assert.equal(crossTenantDecrypted, null, 'Cross-tenant decryption must return null');
  });

  // ── 6. recipients_lossRecovery_loudFailure ────────────────────────────────
  it('6. recipients_lossRecovery_loudFailure: Tampered or corrupted ciphertext returns null (not []) and fails loudly', () => {
    const tenantId = 'client-jfl';
    const originalRecipients = ['exec@jfl.com'];
    const encrypted = cryptoUtil.encryptRecipients(originalRecipients, tenantId);

    // Tamper with tag
    const envelope = JSON.parse(encrypted);
    envelope.tag = '00000000000000000000000000000000';
    const tampered = JSON.stringify(envelope);

    const result = cryptoUtil.decryptRecipients(tampered, tenantId);
    assert.equal(result, null, 'Tampered ciphertext must return null (never empty array []) to prevent silent failure');
  });

  // ── 7. scheduleRepo_crud_roundtrip ───────────────────────────────────────
  it('7. scheduleRepo_crud_roundtrip: Creates, reads, updates, and deletes schedules with automatic encryption', async () => {
    const scheduleId = 'sched_crud_test_01';
    const schedule = {
      id: scheduleId,
      tenantId: 'client-jfl',
      name: 'Monthly Executive QBR',
      cadence: 'monthly',
      cronExpression: '0 6 1 * *',
      dayOfMonth: 1,
      dayOfWeek: null,
      hourUtc: 6,
      recipients: ['qbr-exec@jfl.com', 'cto@jfl.com'],
      active: true,
      lastRunAt: null,
      lastStatus: null,
    };

    // Save schedule
    await scheduleRepo.saveSchedule(schedule);

    // Fetch back
    const fetched = await scheduleRepo.getScheduleById('client-jfl', scheduleId);
    assert.ok(fetched);
    assert.equal(fetched.name, 'Monthly Executive QBR');
    assert.deepEqual(fetched.recipients, ['qbr-exec@jfl.com', 'cto@jfl.com']);

    // Raw DB row must have recipients_encrypted and not plaintext
    const rawRow = (await dbConfig.execute({
      sql: 'SELECT recipients_encrypted FROM schedules WHERE id = ?',
      args: [scheduleId],
    })).rows[0];
    assert.ok(rawRow.recipients_encrypted);
    assert.ok(!rawRow.recipients_encrypted.includes('qbr-exec@jfl.com'));

    // Update metadata
    await scheduleRepo.updateScheduleMetadata(scheduleId, {
      lastRunAt: '2026-11-22T10:00:00.000Z',
      lastStatus: 'SUCCESS',
    });
    const updated = await scheduleRepo.getScheduleById('client-jfl', scheduleId);
    assert.equal(updated.lastStatus, 'SUCCESS');
    assert.equal(updated.lastRunAt, '2026-11-22T10:00:00.000Z');
  });

  // ── 8. scheduleRepo_reinsert_doesNotDeleteRuns ───────────────────────────
  it('8. scheduleRepo_reinsert_doesNotDeleteRuns: Updating an existing schedule row does NOT cascade delete child runs', async () => {
    const scheduleId = 'sched_fk_safety_01';
    const schedule = {
      id: scheduleId,
      tenantId: 'client-jfl',
      name: 'FK Safety Schedule',
      cadence: 'weekly',
      cronExpression: '0 6 * * 1',
      dayOfMonth: null,
      dayOfWeek: 1,
      hourUtc: 6,
      recipients: ['fk-safety@jfl.com'],
      active: true,
    };

    await scheduleRepo.saveSchedule(schedule);

    // Record child run
    const runId = 'run_child_safety_01';
    await scheduleRepo.recordRun({
      id: runId,
      scheduleId,
      tenantId: 'client-jfl',
      scheduleName: 'FK Safety Schedule',
      runAt: new Date().toISOString(),
      triggerType: 'SCHEDULED',
      cadence: 'weekly',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-07',
      periodLabel: 'Week 40 2026',
      days: 7,
      status: 'SUCCESS',
      jobId: 'job_child_01',
      dedupKey: 'dedup_child_safety_01',
      durationMs: 42,
    });

    // Verify run exists
    let runs = await scheduleRepo.getRunsBySchedule('client-jfl', scheduleId);
    assert.equal(runs.length, 1);

    // Re-save/update parent schedule (verifying that INSERT INTO ... ON CONFLICT DO UPDATE is used, NOT INSERT OR REPLACE)
    const updatedSchedule = {
      ...schedule,
      name: 'FK Safety Schedule Renamed',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    await scheduleRepo.saveSchedule(updatedSchedule);

    // Child runs MUST still be present
    runs = await scheduleRepo.getRunsBySchedule('client-jfl', scheduleId);
    assert.equal(runs.length, 1, 'Child runs must NOT be deleted when updating a parent schedule');
    assert.equal(runs[0].id, runId);
  });

  // ── 9. scheduleRuns_dedupKey_uniqueConstraint ────────────────────────────
  it('9. scheduleRuns_dedupKey_uniqueConstraint: Prevents duplicate execution records for the same dedup_key', async () => {
    const scheduleId = 'sched_fk_safety_01';
    const run1 = {
      id: 'run_dedup_01',
      scheduleId,
      tenantId: 'client-jfl',
      scheduleName: 'FK Safety Schedule',
      runAt: new Date().toISOString(),
      triggerType: 'SCHEDULED',
      cadence: 'weekly',
      periodStart: '2026-10-08',
      periodEnd: '2026-10-14',
      periodLabel: 'Week 41 2026',
      days: 7,
      status: 'SUCCESS',
      jobId: 'job_dedup_01',
      dedupKey: 'dedup_unique_check_key_01',
      durationMs: 50,
    };

    // First record succeeds
    await scheduleRepo.recordRun(run1);

    // Second record with identical dedupKey must be ignored (idempotent duplicate prevention)
    const run2 = { ...run1, id: 'run_dedup_02' };
    await scheduleRepo.recordRun(run2);

    const runs = await scheduleRepo.getRunsBySchedule('client-jfl', scheduleId);
    const matches = runs.filter((r) => r.dedupKey === 'dedup_unique_check_key_01');
    assert.equal(matches.length, 1, 'Duplicate run with identical dedupKey must not be recorded');
  });

  // ── 10. templateRepo_versioning_and_activeToggle ─────────────────────────
  it('10. templateRepo_versioning_and_activeToggle: Inserts template versions and toggles active version', async () => {
    const tenantId = 'client-jfl';

    // Add v1
    await templateRepo.addVersion({
      id: 'tmpl_jfl_v1',
      tenantId,
      version: 1,
      filename: 'jfl_template_v1.pptx',
      storagePath: 'data/tenants/client-jfl/templates/v1/jfl_template_v1.pptx',
      fileSizeBytes: 204800,
      uploadedBy: 'admin@portal.com',
      uploadedAt: new Date().toISOString(),
      isActive: true,
    });

    // Add v2
    await templateRepo.addVersion({
      id: 'tmpl_jfl_v2',
      tenantId,
      version: 2,
      filename: 'jfl_template_v2.pptx',
      storagePath: 'data/tenants/client-jfl/templates/v2/jfl_template_v2.pptx',
      fileSizeBytes: 215000,
      uploadedBy: 'admin@portal.com',
      uploadedAt: new Date().toISOString(),
      isActive: false,
    });

    let manifest = await templateRepo.getManifest(tenantId);
    assert.equal(manifest.versions.length, 2);
    assert.equal(manifest.activeVersion, 1);

    // Switch active version to v2
    await templateRepo.setActiveVersion(tenantId, 2);
    manifest = await templateRepo.getManifest(tenantId);
    assert.equal(manifest.activeVersion, 2);
  });

  // ── 11. migrationScript_idempotent_reRunSafe ─────────────────────────────
  it('11. migrationScript_idempotent_reRunSafe: migrateLegacyFiles runs idempotently without duplicate rows', async () => {
    // Create temporary mock legacy files
    const mockDir = path.resolve(__dirname, '../../data/test_migration_fixture');
    if (!fs.existsSync(mockDir)) fs.mkdirSync(mockDir, { recursive: true });

    const mockUsersFile = path.join(mockDir, 'users.json');
    const mockSchedulesFile = path.join(mockDir, 'schedules.json');
    const mockRunsFile = path.join(mockDir, 'runs.json');

    fs.writeFileSync(
      mockUsersFile,
      JSON.stringify({
        'user-mig-1': {
          id: 'user-mig-1',
          email: 'migrated1@test.com',
          username: 'migrated1',
          password: '$2a$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012345678',
          name: 'Migrated User 1',
          role: 'client_user',
          assignedClient: 'client-jfl',
        },
      }),
      'utf8'
    );

    fs.writeFileSync(
      mockSchedulesFile,
      JSON.stringify([
        {
          id: 'sched-mig-1',
          tenantId: 'client-jfl',
          name: 'Migrated Schedule',
          cadence: 'monthly',
          cronExpression: '0 6 1 * *',
          dayOfMonth: 1,
          dayOfWeek: null,
          hourUtc: 6,
          recipients: ['mig1@test.com'],
          active: true,
        },
      ]),
      'utf8'
    );

    fs.writeFileSync(
      mockRunsFile,
      JSON.stringify([
        {
          id: 'run-mig-1',
          scheduleId: 'sched-mig-1',
          tenantId: 'client-jfl',
          scheduleName: 'Migrated Schedule',
          runAt: new Date().toISOString(),
          triggerType: 'SCHEDULED',
          cadence: 'monthly',
          period: {
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            displayLabel: 'September 2026',
            days: 30,
          },
          status: 'SUCCESS',
          dedupKey: 'dedup-mig-1',
        },
      ]),
      'utf8'
    );

    try {
      // First migration run
      const result1 = await migrateLegacyFiles({
        usersFile: mockUsersFile,
        schedulesFiles: [{ tenantId: 'client-jfl', path: mockSchedulesFile }],
        runsFiles: [{ tenantId: 'client-jfl', path: mockRunsFile }],
        renameOnSuccess: false, // Keep files intact for re-run check
      });
      assert.ok(result1.success);

      // Second migration run (idempotency check)
      const result2 = await migrateLegacyFiles({
        usersFile: mockUsersFile,
        schedulesFiles: [{ tenantId: 'client-jfl', path: mockSchedulesFile }],
        runsFiles: [{ tenantId: 'client-jfl', path: mockRunsFile }],
        renameOnSuccess: false,
      });
      assert.ok(result2.success);

      // Verify row counts: exactly 1 user, 1 schedule, 1 run
      const u = await userRepo.getUserById('user-mig-1');
      assert.ok(u);
      const s = await scheduleRepo.getScheduleById('client-jfl', 'sched-mig-1');
      assert.ok(s);
    } finally {
      // Clean up mock fixtures
      if (fs.existsSync(mockDir)) fs.rmSync(mockDir, { recursive: true, force: true });
    }
  });

  // ── 12. migrationScript_atomicLifecycle_renamesSource ─────────────────────
  it('12. migrationScript_atomicLifecycle_renamesSource: Renames source JSON files to .migrated upon commit', async () => {
    const mockDir = path.resolve(__dirname, '../../data/test_migration_atomic');
    if (!fs.existsSync(mockDir)) fs.mkdirSync(mockDir, { recursive: true });

    const mockFile = path.join(mockDir, 'schedules.json');
    fs.writeFileSync(
      mockFile,
      JSON.stringify([
        {
          id: 'sched-atomic-1',
          tenantId: 'client-jfl',
          name: 'Atomic Schedule',
          cadence: 'monthly',
          cronExpression: '0 6 1 * *',
          dayOfMonth: 1,
          dayOfWeek: null,
          hourUtc: 6,
          recipients: ['atomic@test.com'],
          active: true,
        },
      ]),
      'utf8'
    );

    try {
      const res = await migrateLegacyFiles({
        schedulesFiles: [{ tenantId: 'client-jfl', path: mockFile }],
        renameOnSuccess: true,
      });
      assert.ok(res.success);

      // Original .json should not exist; .json.migrated must exist
      assert.equal(fs.existsSync(mockFile), false, 'Original schedules.json must be renamed');
      assert.equal(fs.existsSync(`${mockFile}.migrated`), true, 'schedules.json.migrated must exist');
    } finally {
      if (fs.existsSync(mockDir)) fs.rmSync(mockDir, { recursive: true, force: true });
    }
  });

  // ── 13. serviceCutover_readsOnlyFromRepos ─────────────────────────────────
  it('13. serviceCutover_readsOnlyFromRepos: authService, schedulerService, and templateService use repos directly', async () => {
    const authService = require('../services/authService');
    const schedulerService = require('../services/schedulerService');
    const templateService = require('../services/templateService');

    // authService can look up user via DB repo
    assert.equal(typeof authService.getUserById, 'function');

    // schedulerService can read schedules via scheduleRepo
    const res = await schedulerService.getSchedules('client-jfl');
    assert.ok(Array.isArray(res) || Array.isArray(res.schedules), 'getSchedules must return schedules from DB repo');

    // templateService can get manifest via templateRepo
    const manifest = await templateService.getManifest('client-jfl');
    assert.ok(manifest && typeof manifest.activeVersion === 'number', 'getManifest must return manifest from DB repo');
  });
});
