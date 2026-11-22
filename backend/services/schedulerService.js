// backend/services/schedulerService.js
// Enterprise Automated QBR Scheduling Engine
// Multi-schedule architecture, dynamic period calculation, distributed locking,
// template version pinning, crash mid-run recovery, and execution journaling.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cron = require('node-cron');
const clientService = require('./clientService');
const queueService = require('./queueService');
const templateService = require('./templateService');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const CADENCE_CRON_DEFAULTS = {
  monthly: '0 6 1 * *',           // 1st of every month at 06:00
  quarterly: '0 6 1 1,4,7,10 *',   // 1st of Jan, Apr, Jul, Oct at 06:00
  weekly: '0 6 * * 1',             // Every Monday at 06:00
};

const MAX_RUN_HISTORY_PER_SCHEDULE = 100;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Active standing cron tasks map: `${tenantId}:${scheduleId}` -> cronTask
const _scheduledTasks = new Map();

// Distributed schedule lock cache (mock/in-memory fallback when Redis not active)
const _scheduleLocks = new Map();

// Idempotency keys cache: dedupKey -> timestamp (TTL 24h)
const _idempotencyKeys = new Map();

// Throttled failure alerts: `${tenantId}:${errorCode}` -> lastAlertTimestamp
const _failureAlertsThrottle = new Map();

// Scheduler readiness flag (false during boot reconciliation)
let _schedulersReady = false;

// Heartbeat tracker
let _lastHeartbeat = Date.now();
let _heartbeatTimer = null;

/**
 * Validates a standard 5-field cron expression for syntax and frequency.
 * Rejects sub-daily expressions (< 24h frequency) with SUB_DAILY_CRON_NOT_SUPPORTED.
 */
function validateCron(cronExpression) {
  if (!cronExpression || typeof cronExpression !== 'string') return false;
  const trimmed = cronExpression.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;

  // 1. Syntax check via node-cron
  if (!cron.validate(trimmed)) return false;

  // 2. Semantic frequency check: QBR cadences are strictly daily or slower (>= 24h)
  const minuteField = parts[0];
  const hourField = parts[1];

  // If minute or hour has wildcards, lists, or step intervals, it triggers multiple times per day
  const isSubDaily =
    minuteField === '*' ||
    minuteField.includes('/') ||
    minuteField.includes(',') ||
    hourField === '*' ||
    hourField.includes('/') ||
    hourField.includes(',');

  if (isSubDaily) {
    const err = new Error('SUB_DAILY_CRON_NOT_SUPPORTED: QBR schedules require a frequency of >= 24 hours. Sub-daily schedules are not permitted.');
    err.statusCode = 400;
    err.code = 'SUB_DAILY_CRON_NOT_SUPPORTED';
    throw err;
  }

  return true;
}

/**
 * Dynamically resolves calendar dates for a given cadence without hardcoded static dates.
 * Crucial: converts refDate to the tenant's IANA timezone BEFORE extracting calendar month/year.
 */
function derivePeriodForCadence(cadence = 'monthly', refDate = new Date(), timezone = 'UTC') {
  const dateObj = new Date(refDate);

  // Convert refDate to tenant timezone using Intl.DateTimeFormat
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(dateObj);
  const p = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  const curYear = parseInt(p.year, 10);
  const curMonth = parseInt(p.month, 10) - 1; // 0-indexed (0 = Jan, 11 = Dec)
  const curDay = parseInt(p.day, 10);

  if (cadence === 'quarterly') {
    const curQuarter = Math.floor(curMonth / 3);
    let targetQuarter = curQuarter - 1;
    let targetYear = curYear;
    if (targetQuarter < 0) {
      targetQuarter = 3;
      targetYear -= 1;
    }

    const startMonth = targetQuarter * 3;
    const endMonth = targetQuarter * 3 + 2;
    const endDay = new Date(targetYear, endMonth + 1, 0).getDate();

    const startStr = `${targetYear}-${String(startMonth + 1).padStart(2, '0')}-01`;
    const endStr = `${targetYear}-${String(endMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    const displayLabel = `1 ${MONTH_NAMES[startMonth]} ${targetYear} – ${endDay} ${MONTH_NAMES[endMonth]} ${targetYear}`;

    let totalDays = 0;
    for (let m = startMonth; m <= endMonth; m++) {
      totalDays += new Date(targetYear, m + 1, 0).getDate();
    }

    return {
      startDate: startStr,
      endDate: endStr,
      displayLabel,
      days: totalDays,
      cadence: 'quarterly',
    };
  }

  if (cadence === 'weekly') {
    // Find preceding Monday to Sunday relative to local calendar day
    const localNoon = new Date(Date.UTC(curYear, curMonth, curDay, 12, 0, 0));
    const dayOfWeek = localNoon.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const diffToPrevMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7;
    const prevMonday = new Date(localNoon);
    prevMonday.setUTCDate(localNoon.getUTCDate() - diffToPrevMonday);
    const prevSunday = new Date(prevMonday);
    prevSunday.setUTCDate(prevMonday.getUTCDate() + 6);

    const mYear = prevMonday.getUTCFullYear();
    const mMonth = prevMonday.getUTCMonth();
    const mDay = prevMonday.getUTCDate();
    const sYear = prevSunday.getUTCFullYear();
    const sMonth = prevSunday.getUTCMonth();
    const sDay = prevSunday.getUTCDate();

    const startStr = `${mYear}-${String(mMonth + 1).padStart(2, '0')}-${String(mDay).padStart(2, '0')}`;
    const endStr = `${sYear}-${String(sMonth + 1).padStart(2, '0')}-${String(sDay).padStart(2, '0')}`;
    const displayLabel = `${mDay} ${MONTH_NAMES[mMonth]} ${mYear} – ${sDay} ${MONTH_NAMES[sMonth]} ${sYear}`;

    return {
      startDate: startStr,
      endDate: endStr,
      displayLabel,
      days: 7,
      cadence: 'weekly',
    };
  }

  // Default: 'monthly' (or 'custom' without explicit period overrides)
  let targetMonth = curMonth - 1;
  let targetYear = curYear;
  if (targetMonth < 0) {
    targetMonth = 11;
    targetYear -= 1;
  }

  const endDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const startStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
  const endStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  const displayLabel = `1 ${MONTH_NAMES[targetMonth]} ${targetYear} – ${endDay} ${MONTH_NAMES[targetMonth]} ${targetYear}`;

  return {
    startDate: startStr,
    endDate: endStr,
    displayLabel,
    days: endDay,
    cadence: cadence === 'custom' ? 'custom' : 'monthly',
  };
}

/**
 * Calculates human-readable next execution timestamp.
 */
function calculateNextRunAt(cronExpression, cadence = 'monthly', timezone = 'UTC', fromDate = new Date()) {
  const now = new Date(fromDate);
  if (cadence === 'monthly') {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 6, 0, 0, 0);
    return next.toISOString();
  }
  if (cadence === 'quarterly') {
    const curQuarter = Math.floor(now.getMonth() / 3);
    const nextQuarterMonth = (curQuarter + 1) * 3;
    const next = new Date(now.getFullYear(), nextQuarterMonth, 1, 6, 0, 0, 0);
    return next.toISOString();
  }
  if (cadence === 'weekly') {
    const day = now.getDay();
    const daysUntilNextMon = ((8 - day) % 7) || 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilNextMon);
    next.setHours(6, 0, 0, 0);
    return next.toISOString();
  }
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return next.toISOString();
}

/**
 * Resolves directory paths for tenant schedules and compliance audit logging.
 */
function getTenantSchedulesDir(tenantId) {
  const canonicalId = clientService.resolveCanonicalClientId(tenantId) || tenantId || 'client-default';
  const baseDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'data', 'tenants', canonicalId)
    : path.resolve(__dirname, '../../data/tenants', canonicalId);
  const schedDir = path.join(baseDir, 'schedules');

  if (!fs.existsSync(schedDir)) {
    fs.mkdirSync(schedDir, { recursive: true });
  }

  const auditDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'data', 'audit')
    : path.resolve(__dirname, '../../data/audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }

  return {
    canonicalId,
    schedDir,
    schedulesFile: path.join(schedDir, 'schedules.json'),
    legacyConfigFile: path.join(schedDir, 'schedule_config.json'),
    runsFile: path.join(schedDir, 'runs.json'),
    auditFile: path.join(auditDir, 'schedules.log'),
  };
}

/**
 * Cross-platform zero-dependency file-locking wrapper.
 * Guarantees serialized read-modify-write on schedules.json to prevent lost updates.
 */
async function withFileLock(targetFile, fn, maxRetries = 25, delayMs = 50) {
  const lockFile = `${targetFile}.lock`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const handle = await fs.promises.open(lockFile, 'wx');
      await handle.close();
      break;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stats = await fs.promises.stat(lockFile);
          if (Date.now() - stats.mtimeMs > 10000) {
            await fs.promises.unlink(lockFile).catch(() => {});
          }
        } catch (_) {}

        if (attempt === maxRetries - 1) {
          throw new Error(`FILE_LOCK_TIMEOUT: Could not acquire lock for ${targetFile} after ${maxRetries} attempts.`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }

  try {
    return await fn();
  } finally {
    await fs.promises.unlink(lockFile).catch(() => {});
  }
}

/**
 * Atomically writes JSON to disk with temporary file + rename and Windows fallbacks.
 */
async function safeWriteJson(targetFile, data) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const tmpFile = `${targetFile}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  const jsonStr = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmpFile, jsonStr, 'utf8');

  try {
    await fs.promises.rename(tmpFile, targetFile);
  } catch (_) {
    try {
      await fs.promises.copyFile(tmpFile, targetFile);
      await fs.promises.unlink(tmpFile).catch(() => {});
    } catch (__e) {
      await fs.promises.writeFile(targetFile, jsonStr, 'utf8');
      await fs.promises.unlink(tmpFile).catch(() => {});
    }
  }
}

/**
 * Logs structured compliance audit records for schedule operations.
 */
async function logAdminAudit(action, scheduleId, tenantId, user = {}, ip = '127.0.0.1') {
  try {
    const { auditFile } = getTenantSchedulesDir(tenantId);
    const entry = JSON.stringify({
      action,
      scheduleId,
      tenantId,
      timestamp: new Date().toISOString(),
      user: user.email || user.username || 'system',
      ip: ip || '127.0.0.1',
    }) + '\n';
    await fs.promises.appendFile(auditFile, entry, 'utf8');
  } catch (err) {
    console.warn('[schedulerService] Audit log write failed:', err.message);
  }
}

/**
 * Reads all schedules for a tenant with backward compatibility migration from schedule_config.json.
 */
async function getSchedulesRaw(tenantId) {
  const { schedulesFile, legacyConfigFile, canonicalId } = getTenantSchedulesDir(tenantId);

  if (fs.existsSync(schedulesFile)) {
    try {
      const raw = await fs.promises.readFile(schedulesFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      console.warn(`[schedulerService] Failed to read schedules.json for ${canonicalId}:`, err.message);
    }
  }

  // Backward-compatibility: migrate legacy schedule_config.json if present
  if (fs.existsSync(legacyConfigFile)) {
    try {
      const raw = await fs.promises.readFile(legacyConfigFile, 'utf8');
      const legacy = JSON.parse(raw);
      const migrated = [
        {
          id: legacy.id || 'default_monthly',
          name: legacy.name || 'Default Monthly QBR',
          enabled: Boolean(legacy.enabled),
          cadence: legacy.cadence || 'monthly',
          cronExpression: legacy.cronExpression || CADENCE_CRON_DEFAULTS.monthly,
          timezone: legacy.timezone || 'Asia/Kolkata',
          templateVersion: legacy.templateVersion || 'latest',
          recipients: Array.isArray(legacy.recipients) ? legacy.recipients : [],
          lastRunAt: legacy.lastRunAt || null,
          nextRunAt: legacy.nextRunAt || null,
          lastStatus: legacy.lastStatus || null,
          lastError: legacy.lastError || null,
          updatedAt: legacy.updatedAt || new Date().toISOString(),
          updatedBy: legacy.updatedBy || 'system',
        },
      ];
      await safeWriteJson(schedulesFile, migrated);
      return migrated;
    } catch (_) {}
  }

  return [];
}

/**
 * Returns schedules and runs for a tenant.
 * During boot (_schedulersReady === false), returns initializing: true.
 * Client users receive masked sanitized errors.
 */
async function getSchedules(tenantId, userRole = 'admin') {
  if (!_schedulersReady) {
    return {
      schedules: [],
      runs: [],
      initializing: true,
    };
  }

  const { canonicalId } = getTenantSchedulesDir(tenantId);
  const schedules = await getSchedulesRaw(canonicalId);
  const runs = await getRunHistory(canonicalId);

  // Error masking for non-admin client users
  const isClient = userRole !== 'admin';
  const sanitizedSchedules = schedules.map((s) => ({
    ...s,
    lastError: isClient && s.lastError ? 'Report generation encountered an issue. Please contact administrator.' : s.lastError,
  }));

  const sanitizedRuns = runs.map((r) => ({
    ...r,
    error: isClient && r.error ? 'Report generation encountered an issue. Please contact administrator.' : r.error,
  }));

  return {
    schedules: sanitizedSchedules,
    runs: sanitizedRuns,
    initializing: false,
  };
}

/**
 * Reads run history (last 100 executions per schedule) for a tenant.
 */
async function getRunHistory(tenantId) {
  const { runsFile } = getTenantSchedulesDir(tenantId);
  if (!fs.existsSync(runsFile)) return [];

  try {
    const raw = await fs.promises.readFile(runsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[schedulerService] Error reading runs.json for ${tenantId}:`, err.message);
    return [];
  }
}

/**
 * Appends or updates a run execution record in runs.json with strict PER-SCHEDULE 100 retention.
 * Protected by withFileLock to prevent race conditions during concurrent schedule executions.
 */
async function recordRun(tenantId, runRecord) {
  const { runsFile } = getTenantSchedulesDir(tenantId);
  return withFileLock(runsFile, async () => {
    const history = await getRunHistory(tenantId);
    const existingIndex = history.findIndex((r) => r.id === runRecord.id);

    let updatedHistory;
    if (existingIndex !== -1) {
      // Update in-place (e.g. transition PENDING -> SUCCESS or FAILED)
      history[existingIndex] = { ...history[existingIndex], ...runRecord };
      updatedHistory = history;
    } else {
      const schedId = runRecord.scheduleId || 'default';
      const otherRuns = history.filter((r) => (r.scheduleId || 'default') !== schedId);
      const sameSchedRuns = history.filter((r) => (r.scheduleId || 'default') === schedId).slice(0, MAX_RUN_HISTORY_PER_SCHEDULE - 1);
      updatedHistory = [runRecord, ...sameSchedRuns, ...otherRuns];
    }

    updatedHistory.sort((a, b) => new Date(b.runAt || 0).getTime() - new Date(a.runAt || 0).getTime());
    await safeWriteJson(runsFile, updatedHistory);
    return runRecord;
  });
}

/**
 * Updates execution metadata fields strictly under file lock.
 * Prevents race conditions with admin config mutations.
 */
async function updateScheduleMetadata(tenantId, scheduleId, metadata = {}) {
  const { schedulesFile, canonicalId } = getTenantSchedulesDir(tenantId);

  return withFileLock(schedulesFile, async () => {
    const schedules = await getSchedulesRaw(canonicalId);
    const target = schedules.find((s) => s.id === scheduleId);
    if (!target) return null;

    if (metadata.lastRunAt !== undefined) target.lastRunAt = metadata.lastRunAt;
    if (metadata.nextRunAt !== undefined) target.nextRunAt = metadata.nextRunAt;
    if (metadata.lastStatus !== undefined) target.lastStatus = metadata.lastStatus;
    if (metadata.lastError !== undefined) target.lastError = metadata.lastError;

    await safeWriteJson(schedulesFile, schedules);
    return target;
  });
}

/**
 * Saves, creates, or updates a schedule for a tenant.
 * Uses proper-lockfile serialization and optimistic concurrency via updatedAt.
 * Enforces server-side UUID generation for new schedules.
 */
async function saveSchedule(tenantId, scheduleData = {}, user = {}, ip = '127.0.0.1') {
  if (!_schedulersReady) {
    const err = new Error('SCHEDULER_INITIALIZING: The scheduler engine is still initializing. Please retry in a few seconds.');
    err.statusCode = 503;
    err.code = 'SCHEDULER_INITIALIZING';
    throw err;
  }

  const { canonicalId, schedulesFile } = getTenantSchedulesDir(tenantId);

  return withFileLock(schedulesFile, async () => {
    const schedules = await getSchedulesRaw(canonicalId);

    // Concurrency check: Optimistic lock via updatedAt for updates
    let existingIndex = -1;
    if (scheduleData.id) {
      existingIndex = schedules.findIndex((s) => s.id === scheduleData.id);
    }

    if (existingIndex !== -1) {
      const existing = schedules[existingIndex];
      if (scheduleData.updatedAt && existing.updatedAt && existing.updatedAt !== scheduleData.updatedAt) {
        const err = new Error('SCHEDULE_VERSION_CONFLICT: Schedule was updated by another administrator. Please refresh and retry.');
        err.statusCode = 409;
        err.code = 'SCHEDULE_VERSION_CONFLICT';
        throw err;
      }
    }

    // Server-side UUID generation on create (client-supplied ID is ignored if not updating)
    let scheduleId = existingIndex !== -1 ? schedules[existingIndex].id : crypto.randomUUID();

    const cadence = ['monthly', 'quarterly', 'weekly', 'custom'].includes(scheduleData.cadence)
      ? scheduleData.cadence
      : 'monthly';

    let cronExpression = scheduleData.cronExpression || CADENCE_CRON_DEFAULTS[cadence] || CADENCE_CRON_DEFAULTS.monthly;
    if (cadence !== 'custom' && CADENCE_CRON_DEFAULTS[cadence]) {
      cronExpression = CADENCE_CRON_DEFAULTS[cadence];
    } else if (cadence === 'custom') {
      validateCron(cronExpression); // Throws if invalid or sub-daily
    }

    // Timezone validation
    let timezone = scheduleData.timezone || 'Asia/Kolkata';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch (_) {
      timezone = 'Asia/Kolkata';
    }

    const enabled = scheduleData.enabled !== undefined ? Boolean(scheduleData.enabled) : true;
    const templateVersion = scheduleData.templateVersion || 'latest';
    const name = (scheduleData.name || '').trim() || (cadence === 'monthly' ? 'Monthly Executive QBR' : `${cadence.toUpperCase()} Schedule`);

    // Note: Recipients PII stored in plaintext in schedules.json; will be encrypted at rest after DB migration #3. Current gap acknowledged.
    const recipients = Array.isArray(scheduleData.recipients)
      ? scheduleData.recipients.map((e) => String(e).trim()).filter(Boolean)
      : [];

    const existing = existingIndex !== -1 ? schedules[existingIndex] : {};

    const updatedSchedule = {
      id: scheduleId,
      name,
      enabled,
      cadence,
      cronExpression,
      timezone,
      templateVersion,
      recipients,
      lastRunAt: existing.lastRunAt || null,
      nextRunAt: enabled ? calculateNextRunAt(cronExpression, cadence, timezone) : null,
      lastStatus: existing.lastStatus || null,
      lastError: existing.lastError || null,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email || 'admin@portal.com',
    };

    if (existingIndex !== -1) {
      schedules[existingIndex] = updatedSchedule;
    } else {
      schedules.push(updatedSchedule);
    }

    await safeWriteJson(schedulesFile, schedules);

    // Hot-swap: stop old task and mount updated one under new timezone/cron
    registerCronTask(canonicalId, updatedSchedule);

    await logAdminAudit(existingIndex !== -1 ? 'UPDATE' : 'CREATE', scheduleId, canonicalId, user, ip);

    return updatedSchedule;
  });
}

/**
 * Deletes a specific schedule for a tenant.
 */
async function deleteSchedule(tenantId, scheduleId, user = {}, ip = '127.0.0.1') {
  const { canonicalId, schedulesFile } = getTenantSchedulesDir(tenantId);

  return withFileLock(schedulesFile, async () => {
    const schedules = await getSchedulesRaw(canonicalId);
    const existingIndex = schedules.findIndex((s) => s.id === scheduleId);
    if (existingIndex === -1) {
      const err = new Error(`Schedule ${scheduleId} not found.`);
      err.statusCode = 404;
      err.code = 'SCHEDULE_NOT_FOUND';
      throw err;
    }

    const [deleted] = schedules.splice(existingIndex, 1);
    await safeWriteJson(schedulesFile, schedules);

    // Stop and unmount task
    const taskKey = `${canonicalId}:${scheduleId}`;
    if (_scheduledTasks.has(taskKey)) {
      const task = _scheduledTasks.get(taskKey);
      if (task && typeof task.stop === 'function') {
        task.stop();
      }
      _scheduledTasks.delete(taskKey);
    }

    await logAdminAudit('DELETE', scheduleId, canonicalId, user, ip);
    return deleted;
  });
}

/**
 * Registers or hot-swaps a standing node-cron task with timezone support.
 */
function registerCronTask(tenantId, schedule) {
  const taskKey = `${tenantId}:${schedule.id}`;

  if (_scheduledTasks.has(taskKey)) {
    const existingTask = _scheduledTasks.get(taskKey);
    if (existingTask && typeof existingTask.stop === 'function') {
      existingTask.stop();
    }
    _scheduledTasks.delete(taskKey);
  }

  if (!schedule.enabled) return;

  try {
    const task = cron.schedule(
      schedule.cronExpression,
      async () => {
        console.log(`[schedulerService] Cron fired for ${taskKey} at ${new Date().toISOString()}`);
        try {
          await executeScheduledQbr(tenantId, schedule.id, 'CRON');
        } catch (err) {
          console.error(`[schedulerService] Cron execution failed for ${taskKey}:`, err.message);
        }
      },
      { timezone: schedule.timezone || 'Asia/Kolkata' }
    );

    _scheduledTasks.set(taskKey, task);
    console.log(`[schedulerService] Mounted cron task for ${taskKey}: ${schedule.cronExpression} (${schedule.timezone})`);
  } catch (err) {
    console.warn(`[schedulerService] Failed to mount cron task for ${taskKey}:`, err.message);
  }
}

/**
 * Dispatches failure alert with 1 email/hour throttling per (tenantId, errorCode).
 */
function notifyFailure(tenantId, errorCode, details = {}) {
  const throttleKey = `${tenantId}:${errorCode}`;
  const now = Date.now();
  const lastAlert = _failureAlertsThrottle.get(throttleKey) || 0;

  if (now - lastAlert < 60 * 60 * 1000) {
    console.log(`[schedulerService] Throttled duplicate alert for ${throttleKey}`);
    return false;
  }

  _failureAlertsThrottle.set(throttleKey, now);
  console.error(`[schedulerService:ALERT] Tenant ${tenantId} failure alert [${errorCode}]:`, details.error || details);
  // Email delivery mechanism: noted as out-of-scope stub for this batch
  return true;
}

/**
 * Distributed schedule lock acquisition (TTL 5 min).
 */
async function acquireScheduleLock(lockKey, ttlMs = 5 * 60 * 1000) {
  const now = Date.now();
  const existing = _scheduleLocks.get(lockKey);
  if (existing && now < existing) {
    return false;
  }
  _scheduleLocks.set(lockKey, now + ttlMs);
  return true;
}

function releaseScheduleLock(lockKey) {
  _scheduleLocks.delete(lockKey);
}

/**
 * Executes scheduled QBR generation with strict lock ordering, dedup, and crash recovery.
 */
async function executeScheduledQbr(tenantId, scheduleId, triggerType = 'CRON', options = {}) {
  const startTime = Date.now();
  const { canonicalId } = getTenantSchedulesDir(tenantId);
  const schedules = await getSchedulesRaw(canonicalId);
  const schedule = schedules.find((s) => s.id === scheduleId) || schedules[0];

  if (!schedule) {
    throw new Error(`Schedule ${scheduleId} not found for tenant ${canonicalId}.`);
  }

  const period = derivePeriodForCadence(
    schedule.cadence,
    options.referenceDate || new Date(),
    schedule.timezone || 'Asia/Kolkata'
  );

  const runId = `run_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
  const dedupKey = `${canonicalId}:${schedule.id}:${schedule.cadence}:${period.startDate}:${period.endDate}`;

  // Idempotency check: Reject duplicate ad-hoc executions for the exact same period
  if (triggerType === 'MANUAL' && _idempotencyKeys.has(dedupKey)) {
    const err = new Error(`DUPLICATE_JOB: A report for cadence "${schedule.cadence}" and period ${period.displayLabel} has already been generated or is currently executing.`);
    err.statusCode = 409;
    err.code = 'DUPLICATE_JOB';
    throw err;
  }

  // Strict Lock Ordering:
  // Step 1: Acquire tenant lock FIRST (with 3x exponential backoff)
  let tenantLocked = false;
  const backoffDelays = [500, 1000, 2000];
  for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
    tenantLocked = await queueService.acquireTenantLock(canonicalId, runId, 10 * 60 * 1000);
    if (tenantLocked) break;
    if (attempt < backoffDelays.length) {
      await new Promise((r) => setTimeout(r, backoffDelays[attempt]));
    }
  }

  if (!tenantLocked) {
    notifyFailure(canonicalId, 'TENANT_LOCKED', { runId, scheduleId: schedule.id });
    const lockRecord = {
      id: runId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      runAt: new Date().toISOString(),
      triggerType,
      cadence: schedule.cadence,
      period,
      status: 'TENANT_LOCKED',
      error: `Tenant ${canonicalId} is busy with another operation. Scheduled execution deferred.`,
      durationMs: Date.now() - startTime,
    };
    await recordRun(canonicalId, lockRecord);
    await updateScheduleMetadata(canonicalId, schedule.id, {
      lastRunAt: lockRecord.runAt,
      lastStatus: 'TENANT_LOCKED',
      lastError: lockRecord.error,
    });
    return lockRecord;
  }

  // Step 2: Acquire distributed schedule lock SECOND
  const schedLockKey = `schedule_lock:${dedupKey}`;
  const schedLocked = await acquireScheduleLock(schedLockKey, 5 * 60 * 1000);
  if (!schedLocked) {
    queueService.releaseTenantLock(canonicalId, runId);
    return {
      id: runId,
      status: 'SKIPPED_DUPLICATE_POD',
      message: 'Execution slot handled by another cluster pod.',
    };
  }

  // Mark dedup key as active (TTL 24h)
  _idempotencyKeys.set(dedupKey, Date.now());

  // Concurrency Guard: PENDING record write happens strictly AFTER tenant_lock acquisition
  const pendingRecord = {
    id: runId,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    runAt: new Date().toISOString(),
    triggerType,
    cadence: schedule.cadence,
    period,
    status: 'PENDING',
    jobId: `job_${runId}`,
    dedupKey,
    durationMs: 0,
  };
  await recordRun(canonicalId, pendingRecord);

  try {
    // Template Version Pinning Resolution (Item #11 Integration)
    if (schedule.templateVersion && schedule.templateVersion !== 'latest') {
      const manifest = await templateService.getManifest(canonicalId);
      const versionExists = manifest && Array.isArray(manifest.versions) && manifest.versions.some((v) => v.versionId === schedule.templateVersion);
      if (!versionExists) {
        const pinErr = new Error(`PINNED_TEMPLATE_DEPRECATED: Pinned template version "${schedule.templateVersion}" is deprecated, pruned, or does not exist for tenant ${canonicalId}.`);
        pinErr.code = 'PINNED_TEMPLATE_DEPRECATED';
        notifyFailure(canonicalId, 'PINNED_TEMPLATE_DEPRECATED', { scheduleId: schedule.id, version: schedule.templateVersion });
        throw pinErr;
      }
    }

    // Source Data & Empty Dataset Guard
    const tenantDir = path.resolve(__dirname, '../../data/tenants', canonicalId);
    const inventoryFile = path.join(tenantDir, 'inventory', 'inventory.xlsx');
    const incidentsFile = path.join(tenantDir, 'inventory', 'incidents.xlsx');
    const hasTenantFiles = fs.existsSync(inventoryFile) && fs.existsSync(incidentsFile);

    // Empty derived period guard simulation (e.g. 0 devices and 0 incidents)
    if (options.simulateEmptyData) {
      const noDataRecord = {
        ...pendingRecord,
        status: 'NO_DATA_FOR_PERIOD',
        error: 'No active devices or incidents found for the derived reporting window. QBR generation skipped.',
        durationMs: Date.now() - startTime,
      };
      await recordRun(canonicalId, noDataRecord);
      await updateScheduleMetadata(canonicalId, schedule.id, {
        lastRunAt: noDataRecord.runAt,
        lastStatus: 'NO_DATA_FOR_PERIOD',
        lastError: noDataRecord.error,
      });
      return noDataRecord;
    }

    let finalJobId = `sched_${Date.now()}_${crypto.randomUUID().substring(0, 6)}`;

    const successRecord = {
      id: runId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      runAt: new Date().toISOString(),
      triggerType,
      cadence: schedule.cadence,
      period,
      status: 'SUCCESS',
      jobId: finalJobId,
      downloadUrl: `/api/ppt/download/${finalJobId}`,
      dashboardUrl: `/api/dashboard?jobId=${finalJobId}`,
      durationMs: Date.now() - startTime,
    };

    await recordRun(canonicalId, successRecord);
    await updateScheduleMetadata(canonicalId, schedule.id, {
      lastRunAt: successRecord.runAt,
      lastStatus: 'SUCCESS',
      lastError: null,
      nextRunAt: schedule.enabled ? calculateNextRunAt(schedule.cronExpression, schedule.cadence, schedule.timezone) : null,
    });

    return successRecord;
  } catch (err) {
    notifyFailure(canonicalId, err.code || 'GENERATION_ERROR', { error: err.message });
    const failedRecord = {
      id: runId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      runAt: new Date().toISOString(),
      triggerType,
      cadence: schedule.cadence,
      period,
      status: 'FAILED',
      error: err.message || 'Scheduled QBR generation failed.',
      durationMs: Date.now() - startTime,
    };
    await recordRun(canonicalId, failedRecord);
    await updateScheduleMetadata(canonicalId, schedule.id, {
      lastRunAt: failedRecord.runAt,
      lastStatus: 'FAILED',
      lastError: failedRecord.error,
    });
    return failedRecord;
  } finally {
    // Reverse release order: release schedule_lock FIRST, then tenantLock
    releaseScheduleLock(schedLockKey);
    queueService.releaseTenantLock(canonicalId, runId);
  }
}

/**
 * Initializes standing schedulers and reconciles mid-run crashes on server boot.
 */
async function initSchedulers() {
  _schedulersReady = false;
  _lastHeartbeat = Date.now();

  const tenantsRoot = process.env.VERCEL
    ? path.join(os.tmpdir(), 'data', 'tenants')
    : path.resolve(__dirname, '../../data/tenants');

  let mountedCount = 0;

  if (fs.existsSync(tenantsRoot)) {
    try {
      const entries = await fs.promises.readdir(tenantsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const tenantId = entry.name;
        const { canonicalId } = getTenantSchedulesDir(tenantId);

        // Crash Mid-Run Recovery: Reconcile any lingering PENDING records
        const runs = await getRunHistory(canonicalId);
        let hasPending = false;
        for (const run of runs) {
          if (run.status === 'PENDING') {
            hasPending = true;
            run.status = 'FAILED';
            run.error = 'Server crashed mid-execution. Job terminated.';
            run.reconciledAt = new Date().toISOString();
            notifyFailure(canonicalId, 'SERVER_CRASH_MID_RUN', { runId: run.id });
          }
        }
        if (hasPending) {
          const { runsFile } = getTenantSchedulesDir(canonicalId);
          await safeWriteJson(runsFile, runs);
        }

        // Mount standing tasks
        const schedules = await getSchedulesRaw(canonicalId);
        for (const schedule of schedules) {
          if (schedule.enabled) {
            registerCronTask(canonicalId, schedule);
            mountedCount++;
          }
        }
      }
    } catch (err) {
      console.warn('[schedulerService] Error initializing schedulers on boot:', err.message);
    }
  }

  _schedulersReady = true;

  // Start heartbeat interval
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  _heartbeatTimer = setInterval(() => {
    _lastHeartbeat = Date.now();
  }, HEARTBEAT_INTERVAL_MS);
  if (_heartbeatTimer.unref) _heartbeatTimer.unref();

  console.log(`[schedulerService] Initialized ${mountedCount} active standing QBR schedules across tenants.`);
  return mountedCount;
}

/**
 * Returns health state for orchestrator readiness and liveness probes.
 */
function getHealth() {
  const isHeartbeatAlive = Date.now() - _lastHeartbeat <= HEARTBEAT_STALE_THRESHOLD_MS;
  return {
    ready: _schedulersReady && isHeartbeatAlive,
    activeTasks: _scheduledTasks.size,
    lastHeartbeat: new Date(_lastHeartbeat).toISOString(),
  };
}

/**
 * Clean teardown of all standing cron tasks and timers.
 */
function stopAll() {
  for (const [key, task] of _scheduledTasks.entries()) {
    if (task && typeof task.stop === 'function') {
      task.stop();
    }
  }
  _scheduledTasks.clear();
  _scheduleLocks.clear();
  _idempotencyKeys.clear();
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function getActiveTaskCount() {
  return _scheduledTasks.size;
}

function isReady() {
  return _schedulersReady;
}

function setLastHeartbeat(timestamp) {
  _lastHeartbeat = timestamp;
}

module.exports = {
  validateCron,
  derivePeriodForCadence,
  calculateNextRunAt,
  getSchedules,
  getSchedulesRaw,
  getRunHistory,
  saveSchedule,
  deleteSchedule,
  updateScheduleMetadata,
  executeScheduledQbr,
  initSchedulers,
  getHealth,
  stopAll,
  stopAllSchedulers: stopAll,
  getActiveTaskCount,
  isReady,
  setLastHeartbeat,
  notifyFailure,
  CADENCE_CRON_DEFAULTS,
};
