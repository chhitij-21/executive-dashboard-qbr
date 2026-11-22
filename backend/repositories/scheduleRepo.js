// backend/repositories/scheduleRepo.js
// Multi-Tenant Relational Repository for Scheduled QBRs & Execution History (Item #3)
// Enforces AES-256-GCM recipient encryption and ON CONFLICT DO UPDATE (never INSERT OR REPLACE).

const { execute } = require('../config/database');
const cryptoUtil = require('../utils/cryptoUtil');

/**
 * Maps a raw database row to a structured schedule domain object.
 * Transparently decrypts the recipient list; returns recipients: null on decryption failure.
 */
function mapRowToSchedule(row) {
  if (!row) return null;
  const recipients = cryptoUtil.decryptRecipients(row.recipients_encrypted, row.tenant_id);

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    cadence: row.cadence,
    cronExpression: row.cron_expression,
    dayOfMonth: row.day_of_month,
    dayOfWeek: row.day_of_week,
    hourUtc: row.hour_utc,
    recipients, // Array of strings or null on decryption failure
    recipientsDecryptionFailed: recipients === null,
    active: !!row.active,
    lastRunAt: row.last_run_at || null,
    lastStatus: row.last_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a raw schedule_runs row to a run domain object.
 */
function mapRowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    tenantId: row.tenant_id,
    scheduleName: row.schedule_name,
    runAt: row.run_at,
    triggerType: row.trigger_type,
    cadence: row.cadence,
    period: {
      startDate: row.period_start,
      endDate: row.period_end,
      displayLabel: row.period_label,
      days: row.days,
      cadence: row.cadence,
    },
    status: row.status,
    jobId: row.job_id,
    dedupKey: row.dedup_key,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    downloadUrl: row.download_url,
    dashboardUrl: row.dashboard_url,
    createdAt: row.created_at,
  };
}

/**
 * Saves or updates a schedule.
 * STRICT RULE: Uses INSERT INTO ... ON CONFLICT DO UPDATE (never INSERT OR REPLACE)
 * to avoid deleting cascading child rows (schedule_runs).
 */
async function saveSchedule(schedule) {
  const now = new Date().toISOString();
  const encryptedRecipients = cryptoUtil.encryptRecipients(
    Array.isArray(schedule.recipients) ? schedule.recipients : [],
    schedule.tenantId
  );

  const sql = `
    INSERT INTO schedules (
      id, tenant_id, name, cadence, cron_expression,
      day_of_month, day_of_week, hour_utc, recipients_encrypted,
      active, last_run_at, last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      name = excluded.name,
      cadence = excluded.cadence,
      cron_expression = excluded.cron_expression,
      day_of_month = excluded.day_of_month,
      day_of_week = excluded.day_of_week,
      hour_utc = excluded.hour_utc,
      recipients_encrypted = excluded.recipients_encrypted,
      active = excluded.active,
      last_run_at = COALESCE(excluded.last_run_at, schedules.last_run_at),
      last_status = COALESCE(excluded.last_status, schedules.last_status),
      updated_at = excluded.updated_at
    WHERE schedules.updated_at <= excluded.updated_at
  `;

  await execute(sql, [
    schedule.id,
    schedule.tenantId,
    schedule.name,
    schedule.cadence,
    schedule.cronExpression,
    schedule.dayOfMonth ?? null,
    schedule.dayOfWeek ?? null,
    schedule.hourUtc ?? 6,
    encryptedRecipients,
    schedule.active !== false ? 1 : 0,
    schedule.lastRunAt || null,
    schedule.lastStatus || null,
    schedule.createdAt || now,
    schedule.updatedAt || now,
  ]);

  return getScheduleById(schedule.tenantId, schedule.id);
}

/**
 * Retrieves a single schedule by tenant and ID.
 */
async function getScheduleById(tenantId, scheduleId) {
  const res = await execute(
    'SELECT * FROM schedules WHERE tenant_id = ? AND id = ? LIMIT 1',
    [tenantId, scheduleId]
  );
  return res.rows?.length > 0 ? mapRowToSchedule(res.rows[0]) : null;
}

/**
 * Retrieves all schedules for a given tenant.
 */
async function getSchedulesByTenant(tenantId) {
  const res = await execute(
    'SELECT * FROM schedules WHERE tenant_id = ? ORDER BY created_at ASC',
    [tenantId]
  );
  return (res.rows || []).map(mapRowToSchedule);
}

/**
 * Retrieves all active schedules across all tenants (used by scheduler daemon).
 */
async function getAllActiveSchedules() {
  const res = await execute('SELECT * FROM schedules WHERE active = 1 ORDER BY tenant_id, id');
  return (res.rows || []).map(mapRowToSchedule);
}

/**
 * Updates schedule execution status metadata atomically without modifying configuration.
 */
async function updateScheduleMetadata(scheduleId, { lastRunAt, lastStatus }) {
  const now = new Date().toISOString();
  await execute(
    'UPDATE schedules SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?',
    [lastRunAt || null, lastStatus || null, now, scheduleId]
  );
}

/**
 * Deletes a schedule and cascades to its runs.
 */
async function deleteSchedule(tenantId, scheduleId) {
  await execute(
    'DELETE FROM schedules WHERE tenant_id = ? AND id = ?',
    [tenantId, scheduleId]
  );
  return true;
}

/**
 * Records a schedule run history item.
 * Uses INSERT OR IGNORE on dedup_key to prevent duplicate execution records.
 */
async function recordRun(run) {
  const now = new Date().toISOString();
  const sql = `
    INSERT OR IGNORE INTO schedule_runs (
      id, schedule_id, tenant_id, schedule_name, run_at,
      trigger_type, cadence, period_start, period_end, period_label,
      days, status, job_id, dedup_key, duration_ms, error_message,
      download_url, dashboard_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await execute(sql, [
    run.id,
    run.scheduleId,
    run.tenantId,
    run.scheduleName || 'Scheduled QBR',
    run.runAt || now,
    run.triggerType || 'SCHEDULED',
    run.cadence || run.period?.cadence || 'monthly',
    run.periodStart || run.period?.startDate || '',
    run.periodEnd || run.period?.endDate || '',
    run.periodLabel || run.period?.displayLabel || '',
    run.days || run.period?.days || 30,
    run.status || 'SUCCESS',
    run.jobId || null,
    run.dedupKey,
    run.durationMs ?? null,
    run.errorMessage || null,
    run.downloadUrl || (run.jobId ? `/api/ppt/download/${run.jobId}` : null),
    run.dashboardUrl || (run.jobId ? `/api/dashboard?jobId=${run.jobId}` : null),
    now,
  ]);
}

/**
 * Retrieves all runs for a specific schedule.
 */
async function getRunsBySchedule(tenantId, scheduleId) {
  const res = await execute(
    'SELECT * FROM schedule_runs WHERE tenant_id = ? AND schedule_id = ? ORDER BY run_at DESC',
    [tenantId, scheduleId]
  );
  return (res.rows || []).map(mapRowToRun);
}

/**
 * Retrieves recent runs for a tenant.
 */
async function getRunsByTenant(tenantId, limit = 50) {
  const res = await execute(
    'SELECT * FROM schedule_runs WHERE tenant_id = ? ORDER BY run_at DESC LIMIT ?',
    [tenantId, limit]
  );
  return (res.rows || []).map(mapRowToRun);
}

module.exports = {
  saveSchedule,
  getScheduleById,
  getSchedulesByTenant,
  getAllActiveSchedules,
  updateScheduleMetadata,
  deleteSchedule,
  recordRun,
  getRunsBySchedule,
  getRunsByTenant,
};
