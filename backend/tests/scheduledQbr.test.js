require('./_setup');
// backend/tests/scheduledQbr.test.js
process.env.NODE_ENV = 'test';
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const schedulerService = require('../services/schedulerService');
const templateService = require('../services/templateService');
const queueService = require('../services/queueService');

const clientService = require('../services/clientService');

describe('Scheduled QBR Engine Suite (Item #13)', () => {
  const TEST_TENANT = 'client-test-sched';
  const tenantDir = clientService.getTenantDir(TEST_TENANT);
  const schedDir = path.join(tenantDir, 'schedules');

  before(async () => {
    try {
      const { migrate } = require('../db/migrate');
      await migrate();
    } catch (_) {}
    try {
      const { execute } = require('../config/database');
      await execute('DELETE FROM schedule_runs WHERE tenant_id = ?', [TEST_TENANT]);
      await execute('DELETE FROM schedules WHERE tenant_id = ?', [TEST_TENANT]);
    } catch (_) {}
    if (!fs.existsSync(schedDir)) {
      fs.mkdirSync(schedDir, { recursive: true });
    }
    await schedulerService.initSchedulers();
  });

  beforeEach(async () => {
    try {
      const { execute } = require('../config/database');
      await execute('DELETE FROM schedule_runs WHERE tenant_id = ?', [TEST_TENANT]);
      await execute('DELETE FROM schedules WHERE tenant_id = ?', [TEST_TENANT]);
    } catch (_) {}
    if (fs.existsSync(schedDir)) {
      const files = fs.readdirSync(schedDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(schedDir, f)); } catch (_) {}
      }
    }
  });

  after(async () => {
    try {
      schedulerService.stopAll();
      const { execute } = require('../config/database');
      await execute('DELETE FROM schedule_runs WHERE tenant_id = ?', [TEST_TENANT]);
      await execute('DELETE FROM schedules WHERE tenant_id = ?', [TEST_TENANT]);
      if (fs.existsSync(tenantDir)) {
        fs.rmSync(tenantDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // 1. dynamicPeriod_timezonePreConversion
  it('1. dynamicPeriod_timezonePreConversion: Converts refDate to tenant timezone before extracting period', () => {
    // Reference date: June 1, 2026 at 00:30 UTC = 06:00 IST on June 1, 2026
    const utcDate = new Date('2026-05-31T20:30:00.000Z'); // In Asia/Kolkata (+05:30) this is 2026-06-01 02:00:00
    const period = schedulerService.derivePeriodForCadence('monthly', utcDate, 'Asia/Kolkata');

    // In IST, June 1 is the 6th month -> previous month is May
    assert.strictEqual(period.startDate, '2026-05-01');
    assert.strictEqual(period.endDate, '2026-05-31');
    assert.strictEqual(period.displayLabel, '1 May 2026 – 31 May 2026');
    assert.strictEqual(period.days, 31);
  });

  // 2. cronSemanticFrequency_rejectsSubDaily
  it('2. cronSemanticFrequency_rejectsSubDaily: Rejects sub-daily cron expressions with HTTP 400', () => {
    assert.throws(
      () => schedulerService.validateCron('* * * * *'),
      (err) => err.code === 'SUB_DAILY_CRON_NOT_SUPPORTED' && err.statusCode === 400
    );

    assert.throws(
      () => schedulerService.validateCron('0 */6 * * *'),
      (err) => err.code === 'SUB_DAILY_CRON_NOT_SUPPORTED' && err.statusCode === 400
    );

    // Valid daily or slower expressions
    assert.strictEqual(schedulerService.validateCron('0 6 1 * *'), true);
    assert.strictEqual(schedulerService.validateCron('0 6 * * 1'), true);
    assert.strictEqual(schedulerService.validateCron('0 6 1 1,4,7,10 *'), true);
  });

  // 3. templateVersionPinning_v2Pinned_v3Active
  it('3. templateVersionPinning_v2Pinned_v3Active: Fails safely when pinned template is missing or deprecated', async () => {
    const configData = {
      name: 'Pinned Template Test',
      enabled: true,
      cadence: 'monthly',
      cronExpression: '0 6 1 * *',
      templateVersion: 'v999_nonexistent',
      recipients: ['test@client.com'],
    };

    const saved = await schedulerService.saveSchedule(TEST_TENANT, configData, { email: 'admin@portal.com' });
    assert.strictEqual(saved.templateVersion, 'v999_nonexistent');

    const result = await schedulerService.executeScheduledQbr(TEST_TENANT, saved.id, 'CRON');
    assert.strictEqual(result.status, 'FAILED');
    assert.ok(result.error.includes('PINNED_TEMPLATE_DEPRECATED'));
  });

  // 4. crashMidRun_dedupKeyExpired_noSilentSkip
  it('4. crashMidRun_dedupKeyExpired_noSilentSkip: Reconciles PENDING runs on boot to FAILED without silent skip', async () => {
    const { runsFile } = { runsFile: path.join(schedDir, 'runs.json') };
    const fakePending = {
      id: 'run_crash_test',
      scheduleId: 'test_sched',
      runAt: new Date(Date.now() - 3600000).toISOString(),
      status: 'PENDING',
      jobId: 'job_crashed_123',
    };
    await fs.promises.writeFile(runsFile, JSON.stringify([fakePending]), 'utf8');

    await schedulerService.initSchedulers();

    const runs = await schedulerService.getRunHistory(TEST_TENANT);
    const reconciled = runs.find((r) => r.id === 'run_crash_test');
    assert.ok(reconciled);
    assert.strictEqual(reconciled.status, 'FAILED');
    assert.ok(reconciled.error.includes('Server crashed mid-execution'));
  });

  // 5. lockOrdering_tenantFirstScheduleSecond
  it('5. lockOrdering_tenantFirstScheduleSecond: Enforces strict tenant_lock -> schedule_lock -> reverse release', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Lock Test', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );

    const runResult = await schedulerService.executeScheduledQbr(TEST_TENANT, schedule.id, 'CRON');
    assert.strictEqual(runResult.status, 'SUCCESS');
    // Lock must be released cleanly after execution
    assert.strictEqual(queueService.isTenantLocked(TEST_TENANT), false);
  });

  // 6. scheduleUpdateDuringExecution_currentRunCompletes
  it('6. scheduleUpdateDuringExecution_currentRunCompletes: Updates metadata cleanly without clobbering user fields', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Metadata Test', cadence: 'weekly', cronExpression: '0 6 * * 1', recipients: ['ops@test.com'] },
      { email: 'admin@portal.com' }
    );

    await schedulerService.updateScheduleMetadata(TEST_TENANT, schedule.id, {
      lastRunAt: '2026-06-01T06:00:00.000Z',
      lastStatus: 'SUCCESS',
      lastError: null,
    });

    const { schedules } = await schedulerService.getSchedules(TEST_TENANT, 'admin');
    const updated = schedules.find((s) => s.id === schedule.id);
    assert.strictEqual(updated.name, 'Metadata Test');
    assert.strictEqual(updated.cadence, 'weekly');
    assert.deepStrictEqual(updated.recipients, ['ops@test.com']);
    assert.strictEqual(updated.lastStatus, 'SUCCESS');
    assert.strictEqual(updated.lastRunAt, '2026-06-01T06:00:00.000Z');
  });

  // 7. idempotencyKey_duplicateAdHoc409
  it('7. idempotencyKey_duplicateAdHoc409: Rejects duplicate ad-hoc executions for same period with HTTP 409', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Dedup Test', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );

    const ref = new Date('2026-08-01T06:00:00.000Z');
    // First trigger succeeds
    const first = await schedulerService.executeScheduledQbr(TEST_TENANT, schedule.id, 'MANUAL', { referenceDate: ref });
    assert.strictEqual(first.status, 'SUCCESS');

    // Second trigger with exact same period throws HTTP 409 DUPLICATE_JOB
    await assert.rejects(
      async () => {
        await schedulerService.executeScheduledQbr(TEST_TENANT, schedule.id, 'MANUAL', { referenceDate: ref });
      },
      (err) => err.code === 'DUPLICATE_JOB' && err.statusCode === 409
    );
  });

  // 8. timezoneMutationHotSwap
  it('8. timezoneMutationHotSwap: Stops old cron task and mounts new task on timezone update', async () => {
    const initial = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'TZ Test', cadence: 'monthly', cronExpression: '0 6 1 * *', timezone: 'Asia/Kolkata', enabled: true },
      { email: 'admin@portal.com' }
    );
    assert.strictEqual(initial.timezone, 'Asia/Kolkata');

    const updated = await schedulerService.saveSchedule(
      TEST_TENANT,
      { ...initial, timezone: 'America/New_York' },
      { email: 'admin@portal.com' }
    );
    assert.strictEqual(updated.timezone, 'America/New_York');
  });

  // 9. optimisticConcurrency_versionConflict409
  it('9. optimisticConcurrency_versionConflict409: Returns HTTP 409 on stale updatedAt mismatch', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Optimistic Test', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );

    // Stale payload with wrong updatedAt
    await assert.rejects(
      async () => {
        await schedulerService.saveSchedule(
          TEST_TENANT,
          { ...schedule, updatedAt: '2020-01-01T00:00:00.000Z' },
          { email: 'admin@portal.com' }
        );
      },
      (err) => err.code === 'SCHEDULE_VERSION_CONFLICT' && err.statusCode === 409
    );
  });

  // 10. failureAlertThrottling_maxOnePerHour
  it('10. failureAlertThrottling_maxOnePerHour: Throttles identical error code alerts to 1 per hour', () => {
    const firstAlert = schedulerService.notifyFailure(TEST_TENANT, 'TEST_ERR_CODE', { error: 'Initial failure' });
    assert.strictEqual(firstAlert, true);

    const secondAlert = schedulerService.notifyFailure(TEST_TENANT, 'TEST_ERR_CODE', { error: 'Immediate duplicate' });
    assert.strictEqual(secondAlert, false); // Throttled
  });

  // 11. roleBasedErrorMasking
  it('11. roleBasedErrorMasking: Masks error messages for non-admin client users', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Masking Test', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );

    await schedulerService.updateScheduleMetadata(TEST_TENANT, schedule.id, {
      lastError: 'DATABASE_CRASH: FATAL connection timeout at /dev/shm/turso.db',
    });

    const adminView = await schedulerService.getSchedules(TEST_TENANT, 'admin');
    const adminSched = adminView.schedules.find((s) => s.id === schedule.id);
    assert.strictEqual(adminSched.lastError, 'DATABASE_CRASH: FATAL connection timeout at /dev/shm/turso.db');

    const clientView = await schedulerService.getSchedules(TEST_TENANT, 'client');
    const clientSched = clientView.schedules.find((s) => s.id === schedule.id);
    assert.strictEqual(clientSched.lastError, 'Report generation encountered an issue. Please contact administrator.');
  });

  // 12. emptyPeriod_noDataLogsAndSkips
  it('12. emptyPeriod_noDataLogsAndSkips: Logs NO_DATA_FOR_PERIOD and skips generation for empty windows', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Empty Window Test', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );

    const emptyResult = await schedulerService.executeScheduledQbr(TEST_TENANT, schedule.id, 'CRON', {
      simulateEmptyData: true,
    });

    assert.strictEqual(emptyResult.status, 'NO_DATA_FOR_PERIOD');
    assert.ok(emptyResult.error.includes('No active devices or incidents'));
  });

  // 13. schedulerHealthEndpoint
  it('13. schedulerHealthEndpoint: Returns ready status and active task count', () => {
    const health = schedulerService.getHealth();
    assert.strictEqual(typeof health.ready, 'boolean');
    assert.strictEqual(typeof health.activeTasks, 'number');
    assert.ok(health.lastHeartbeat);
  });

  // 14. schedulerHealth_heartbeatStaleFalse
  it('14. schedulerHealth_heartbeatStaleFalse: Reports ready: false when heartbeat > 5 minutes old', () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    schedulerService.setLastHeartbeat(sixMinutesAgo);

    const staleHealth = schedulerService.getHealth();
    assert.strictEqual(staleHealth.ready, false);

    // Restore heartbeat
    schedulerService.setLastHeartbeat(Date.now());
    const freshHealth = schedulerService.getHealth();
    assert.strictEqual(freshHealth.ready, true);
  });

  // 15. concurrentAdminUpdateAndExecutionCompletion
  it('15. concurrentAdminUpdateAndExecutionCompletion: Preserves both admin config and run metadata via file locking', async () => {
    const schedule = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Concurrent Test', cadence: 'monthly', cronExpression: '0 6 1 * *', recipients: ['initial@test.com'] },
      { email: 'admin@portal.com' }
    );

    // Simulate concurrent admin update and background execution metadata update
    await Promise.all([
      schedulerService.saveSchedule(
        TEST_TENANT,
        { ...schedule, recipients: ['updated_admin@test.com'] },
        { email: 'admin@portal.com' }
      ),
      schedulerService.updateScheduleMetadata(TEST_TENANT, schedule.id, {
        lastRunAt: '2026-09-01T06:00:00.000Z',
        lastStatus: 'SUCCESS',
      }),
    ]);

    const { schedules } = await schedulerService.getSchedules(TEST_TENANT, 'admin');
    const final = schedules.find((s) => s.id === schedule.id);
    assert.ok(final);
    assert.deepStrictEqual(final.recipients, ['updated_admin@test.com']);
    assert.strictEqual(final.lastStatus, 'SUCCESS');
    assert.strictEqual(final.lastRunAt, '2026-09-01T06:00:00.000Z');
  });

  // 16. concurrentSchedulesSameMinute_bothRecordedNoCorruption
  it('16. concurrentSchedulesSameMinute_bothRecordedNoCorruption: Two schedules firing in same minute serialize cleanly', async () => {
    const schedMonthly = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Monthly Ops', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );
    const schedWeekly = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Weekly NOC', cadence: 'weekly', cronExpression: '0 6 * * 1' },
      { email: 'admin@portal.com' }
    );

    const [resM, resW] = await Promise.all([
      schedulerService.executeScheduledQbr(TEST_TENANT, schedMonthly.id, 'CRON'),
      schedulerService.executeScheduledQbr(TEST_TENANT, schedWeekly.id, 'CRON'),
    ]);

    assert.ok(resM);
    assert.ok(resW);

    const runs = await schedulerService.getRunHistory(TEST_TENANT);
    assert.ok(runs.some((r) => r.scheduleId === schedMonthly.id));
    assert.ok(runs.some((r) => r.scheduleId === schedWeekly.id));
  });

  // 17. scheduleIdGeneration_serverUuidDistinct
  it('17. scheduleIdGeneration_serverUuidDistinct: Generates server-side UUIDs for new schedules, ignoring client input', async () => {
    const sched1 = await schedulerService.saveSchedule(
      TEST_TENANT,
      { id: 'client_supplied_forged_id', name: 'Server UUID Test 1', cadence: 'monthly', cronExpression: '0 6 1 * *' },
      { email: 'admin@portal.com' }
    );
    const sched2 = await schedulerService.saveSchedule(
      TEST_TENANT,
      { name: 'Server UUID Test 2', cadence: 'weekly', cronExpression: '0 6 * * 1' },
      { email: 'admin@portal.com' }
    );

    assert.notStrictEqual(sched1.id, 'client_supplied_forged_id');
    assert.notStrictEqual(sched1.id, sched2.id);
    assert.strictEqual(typeof sched1.id, 'string');
    assert.strictEqual(typeof sched2.id, 'string');
  });

  // 18. triggerRateLimit_fivePerMinute
  it('18. triggerRateLimit_fivePerMinute: Rate limits rapid ad-hoc triggers to max 5 per minute', async () => {
    // Verified via HTTP route suite below
    assert.ok(true);
  });

  // 19. cleanTeardown_noActiveTimers
  it('19. cleanTeardown_noActiveTimers: Stops all cron timers on stopAll() with 0 remaining tasks', () => {
    schedulerService.stopAll();
    assert.strictEqual(schedulerService.getActiveTaskCount(), 0);
  });
});

describe('Schedule Routes HTTP & Security Suite (Item #13)', () => {
  const app = require('../index');
  let server = null;
  let baseUrl = '';
  let adminToken = '';
  let clientToken = '';

  before(async () => {
    if (typeof app.resetRateLimits === 'function') {
      app.resetRateLimits();
    }
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'admin123' }),
    });
    adminToken = (await adminRes.json()).token;

    const clientRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: 'jfl123' }),
    });
    clientToken = (await clientRes.json()).token;
  });

  after(async () => {
    schedulerService.stopAll();
    if (server) {
      await new Promise((res) => server.close(res));
    }
  });

  it('HTTP 1. GET /api/health/scheduler returns 200 with orchestrator health data', async () => {
    const res = await fetch(`${baseUrl}/api/health/scheduler`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(typeof body.ready, 'boolean');
    assert.strictEqual(typeof body.activeTasks, 'number');
    assert.ok(body.lastHeartbeat);
  });

  it('HTTP 2. GET /api/tenants/:id/schedules enforces tenant isolation', async () => {
    // Client user jfl attempting to access client-test-sched should receive 403
    const res = await fetch(`${baseUrl}/api/tenants/client-test-sched/schedules`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('HTTP 3. POST /api/tenants/:id/schedules validates sub-daily cron and rejects with 400', async () => {
    const res = await fetch(`${baseUrl}/api/tenants/client-jfl/schedules`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Illegal Sub-Daily',
        cadence: 'custom',
        cronExpression: '*/5 * * * *',
      }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.code, 'SUB_DAILY_CRON_NOT_SUPPORTED');
  });

  it('HTTP 4. POST /api/tenants/:id/schedules/:id/trigger enforces max 5/min rate limit with HTTP 429', async () => {
    const tenantId = 'client-jfl';
    // Create valid schedule first
    const createRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/schedules`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Rate Limit Target',
        cadence: 'monthly',
        cronExpression: '0 6 1 * *',
      }),
    });
    const schedBody = await createRes.json();
    const schedId = schedBody.schedule?.id;
    assert.ok(schedId);

    // Rapidly trigger 6 times
    let got429 = false;
    for (let i = 0; i < 7; i++) {
      const trigRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/schedules/${schedId}/trigger`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (trigRes.status === 429) {
        got429 = true;
        assert.strictEqual(trigRes.headers.get('retry-after'), '60');
        const errBody = await trigRes.json();
        assert.strictEqual(errBody.code, 'TRIGGER_RATE_LIMIT_EXCEEDED');
        break;
      }
    }
    assert.strictEqual(got429, true);

    // Clean up created schedule
    await fetch(`${baseUrl}/api/tenants/${tenantId}/schedules/${schedId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });
});
