// backend/db/migrate-legacy-files.js
// Idempotent Legacy JSON File to Relational Database Migration (Item #3)
// Strictly one-way migration: takes pre-migration snapshot, uses ON CONFLICT DO UPDATE, renames to .migrated.

const fs = require('fs');
const path = require('path');
const userRepo = require('../repositories/userRepo');
const scheduleRepo = require('../repositories/scheduleRepo');
const templateRepo = require('../repositories/templateRepo');
const { migrate: runSchemaMigration } = require('./migrate');

/**
 * Creates an atomic pre-migration backup of target files into data/backup_pre_item3_<timestamp>/
 */
function createPreMigrationBackup(filesToBackup) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, `../../data/backup_pre_item3_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const filePath of filesToBackup) {
    if (fs.existsSync(filePath)) {
      const relative = path.relative(path.resolve(__dirname, '../../data'), filePath);
      const target = path.join(backupDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(filePath, target);
    }
  }
  return backupDir;
}

/**
 * Executes the migration of legacy files into the relational database.
 * @param {object} [options] Custom paths for test fixtures
 */
async function migrateLegacyFiles(options = {}) {
  // Concurrency guard: scheduled QBR daemon must not be running during migration
  if (process.env.ENABLE_SCHEDULED_QBR === 'true') {
    throw new Error(
      '[MIGRATION ABORTED] ENABLE_SCHEDULED_QBR is set to true. Scheduler must be stopped during database migration to prevent race conditions.'
    );
  }

  // Ensure database schema is migrated
  await runSchemaMigration();

  const dataDir = path.resolve(__dirname, '../../data');
  const defaultUsersFile = path.join(dataDir, 'users.json');
  const usersFile = options.usersFile || defaultUsersFile;
  const renameOnSuccess = options.renameOnSuccess !== false;

  const migratedFiles = [];
  const filesToBackup = [];

  if (fs.existsSync(usersFile)) filesToBackup.push(usersFile);

  // Discover tenant schedule & template files
  const tenantsDir = path.join(dataDir, 'tenants');
  const schedulesFiles = options.schedulesFiles || [];
  const runsFiles = options.runsFiles || [];
  const templatesFiles = options.templatesFiles || [];

  if (!options.schedulesFiles && fs.existsSync(tenantsDir)) {
    const tenantEntries = fs.readdirSync(tenantsDir, { withFileTypes: true });
    for (const entry of tenantEntries) {
      if (entry.isDirectory()) {
        const tenantId = entry.name;
        const schedFile = path.join(tenantsDir, tenantId, 'schedules', 'schedules.json');
        const legacyCfgFile = path.join(tenantsDir, tenantId, 'schedules', 'schedule_config.json');
        const runFile = path.join(tenantsDir, tenantId, 'schedules', 'runs.json');
        const tmplFile = path.join(tenantsDir, tenantId, 'templates', 'templates_manifest.json');

        if (fs.existsSync(schedFile)) {
          schedulesFiles.push({ tenantId, path: schedFile });
          filesToBackup.push(schedFile);
        }
        if (fs.existsSync(legacyCfgFile)) {
          schedulesFiles.push({ tenantId, path: legacyCfgFile, isLegacySingle: true });
          filesToBackup.push(legacyCfgFile);
        }
        if (fs.existsSync(runFile)) {
          runsFiles.push({ tenantId, path: runFile });
          filesToBackup.push(runFile);
        }
        if (fs.existsSync(tmplFile)) {
          templatesFiles.push({ tenantId, path: tmplFile });
          filesToBackup.push(tmplFile);
        }
      }
    }
  }

  // Global template manifest
  const globalTmplFile = path.join(dataDir, 'templates_manifest.json');
  if (fs.existsSync(globalTmplFile)) {
    templatesFiles.push({ tenantId: 'global', path: globalTmplFile });
    filesToBackup.push(globalTmplFile);
  }

  // Step 0: Pre-migration snapshot (if running against real data)
  let backupDir = null;
  if (!options.usersFile && filesToBackup.length > 0) {
    backupDir = createPreMigrationBackup(filesToBackup);
    console.log(`[migrate-legacy-files] Pre-migration snapshot saved to: ${backupDir}`);
  }

  let usersCount = 0;
  let schedulesCount = 0;
  let runsCount = 0;
  let templatesCount = 0;

  // ── 1. Ingest users.json ──────────────────────────────────────────────────
  if (fs.existsSync(usersFile)) {
    try {
      const raw = fs.readFileSync(usersFile, 'utf8');
      const parsed = JSON.parse(raw);
      const userList = Array.isArray(parsed) ? parsed : Object.values(parsed);

      for (const u of userList) {
        if (u && (u.id || u.email)) {
          await userRepo.createUser({
            id: u.id || `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            email: u.email,
            username: u.username || u.email.split('@')[0],
            password_hash: u.password || u.password_hash || '$2a$10$demoHashedPasswordFallback01234567890123456789',
            name: u.name || 'Portal User',
            role: u.role || 'client_user',
            assigned_client: u.assignedClient || u.assigned_client || 'client-jfl',
            avatar: u.avatar,
            mfa_secret: u.mfaSecret || u.mfa_secret || null,
            mfa_enabled: u.mfaEnabled || u.mfa_enabled ? 1 : 0,
            pending_mfa_secret: u.pendingMfaSecret || u.pending_mfa_secret || null,
          });
          usersCount++;
        }
      }
      migratedFiles.push(usersFile);
    } catch (err) {
      throw new Error(`[MIGRATION ERROR] Failed ingesting users from ${usersFile}: ${err.message}`);
    }
  }

  // ── 2. Ingest schedules.json & schedule_config.json ───────────────────────
  for (const item of schedulesFiles) {
    if (fs.existsSync(item.path)) {
      try {
        const raw = fs.readFileSync(item.path, 'utf8');
        const parsed = JSON.parse(raw);

        if (item.isLegacySingle && parsed && typeof parsed === 'object') {
          // Merge legacy schedule_config.json if not present
          const existing = await scheduleRepo.getSchedulesByTenant(item.tenantId);
          if (existing.length === 0) {
            await scheduleRepo.saveSchedule({
              id: `sched_legacy_${item.tenantId}`,
              tenantId: item.tenantId,
              name: 'Quarterly Executive Review',
              cadence: parsed.cadence || 'quarterly',
              cronExpression: parsed.cronExpression || '0 6 1 1,4,7,10 *',
              hourUtc: 6,
              recipients: Array.isArray(parsed.recipients) ? parsed.recipients : ['exec@jfl.com'],
              active: parsed.enabled !== false,
              lastRunAt: parsed.lastRunAt || null,
              lastStatus: parsed.lastStatus || null,
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            });
            schedulesCount++;
          }
        } else if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (s && s.id) {
              await scheduleRepo.saveSchedule({
                id: s.id,
                tenantId: s.tenantId || item.tenantId,
                name: s.name,
                cadence: s.cadence,
                cronExpression: s.cronExpression,
                dayOfMonth: s.dayOfMonth ?? null,
                dayOfWeek: s.dayOfWeek ?? null,
                hourUtc: s.hourUtc ?? 6,
                recipients: Array.isArray(s.recipients) ? s.recipients : [],
                active: s.active !== false,
                lastRunAt: s.lastRunAt || null,
                lastStatus: s.lastStatus || null,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              });
              schedulesCount++;
            }
          }
        }
        migratedFiles.push(item.path);
      } catch (err) {
        throw new Error(`[MIGRATION ERROR] Failed ingesting schedules from ${item.path}: ${err.message}`);
      }
    }
  }

  // ── 3. Ingest runs.json ───────────────────────────────────────────────────
  for (const item of runsFiles) {
    if (fs.existsSync(item.path)) {
      try {
        const raw = fs.readFileSync(item.path, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            if (r && r.id && r.scheduleId) {
              // Ensure parent schedule exists before inserting child run to respect foreign keys
              const parentSchedule = await scheduleRepo.getScheduleById(item.tenantId, r.scheduleId);
              if (!parentSchedule) {
                // If parent schedule doesn't exist, create placeholder to preserve FK integrity
                await scheduleRepo.saveSchedule({
                  id: r.scheduleId,
                  tenantId: item.tenantId,
                  name: r.scheduleName || 'Archived Schedule',
                  cadence: r.cadence || r.period?.cadence || 'monthly',
                  cronExpression: '0 6 1 * *',
                  hourUtc: 6,
                  recipients: [],
                  active: false,
                });
              }

              await scheduleRepo.recordRun({
                id: r.id,
                scheduleId: r.scheduleId,
                tenantId: item.tenantId,
                scheduleName: r.scheduleName,
                runAt: r.runAt,
                triggerType: r.triggerType,
                cadence: r.cadence,
                periodStart: r.period?.startDate || '',
                periodEnd: r.period?.endDate || '',
                periodLabel: r.period?.displayLabel || '',
                days: r.period?.days || 30,
                status: r.status,
                jobId: r.jobId,
                dedupKey: r.dedupKey || `${item.tenantId}:${r.scheduleId}:${r.id}`,
                durationMs: r.durationMs,
                errorMessage: r.errorMessage,
                downloadUrl: r.downloadUrl,
                dashboardUrl: r.dashboardUrl,
              });
              runsCount++;
            }
          }
        }
        migratedFiles.push(item.path);
      } catch (err) {
        throw new Error(`[MIGRATION ERROR] Failed ingesting runs from ${item.path}: ${err.message}`);
      }
    }
  }

  // ── 4. Ingest templates_manifest.json ─────────────────────────────────────
  for (const item of templatesFiles) {
    if (fs.existsSync(item.path)) {
      try {
        const raw = fs.readFileSync(item.path, 'utf8');
        const parsed = JSON.parse(raw);
        const versions = parsed.versions || [];
        const activeVersion = parsed.activeVersion || 1;

        for (const v of versions) {
          if (v && v.version) {
            await templateRepo.addVersion({
              id: `${item.tenantId}_v${v.version}`,
              tenantId: item.tenantId,
              version: v.version,
              filename: v.filename || `template_v${v.version}.pptx`,
              storagePath: v.storagePath || `data/tenants/${item.tenantId}/templates/v${v.version}/master.pptx`,
              fileSizeBytes: v.fileSizeBytes || v.size || 0,
              uploadedBy: v.uploadedBy || 'admin@portal.com',
              uploadedAt: v.uploadedAt || new Date().toISOString(),
              isActive: v.version === activeVersion,
            });
            templatesCount++;
          }
        }
        migratedFiles.push(item.path);
      } catch (err) {
        throw new Error(`[MIGRATION ERROR] Failed ingesting template manifest from ${item.path}: ${err.message}`);
      }
    }
  }

  // ── 5. Rename files to .migrated only AFTER DB commit ─────────────────────
  if (renameOnSuccess) {
    for (const filePath of migratedFiles) {
      if (fs.existsSync(filePath)) {
        const dest = `${filePath}.migrated`;
        try {
          fs.renameSync(filePath, dest);
        } catch (e) {
          // Windows lock fallback
          fs.copyFileSync(filePath, dest);
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }
    }
  }

  return {
    success: true,
    usersCount,
    schedulesCount,
    runsCount,
    templatesCount,
    backupDir,
    migratedFilesCount: migratedFiles.length,
  };
}

if (require.main === module) {
  migrateLegacyFiles()
    .then((res) => {
      console.log('[migrate-legacy-files] SUCCESS:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate-legacy-files] FATAL:', err.message);
      process.exit(1);
    });
}

module.exports = {
  migrateLegacyFiles,
  createPreMigrationBackup,
};
