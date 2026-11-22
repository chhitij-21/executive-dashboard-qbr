// frontend/src/__tests__/ScheduleManagerModal.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduleManagerModal from '../components/ScheduleManagerModal';

describe('ScheduleManagerModal Component (Item #13)', () => {
  const mockClient = {
    id: 'client-jfl',
    name: 'Jubilant Foodworks Ltd (JFL)',
    code: 'JFL',
  };

  const mockSchedules = [
    {
      id: 'sched_monthly',
      name: 'Monthly Executive QBR',
      enabled: true,
      cadence: 'monthly',
      cronExpression: '0 6 1 * *',
      timezone: 'Asia/Kolkata',
      templateVersion: 'latest',
      recipients: ['cio@dominos.in'],
      nextRunAt: '2026-06-01T06:00:00.000Z',
      lastRunAt: '2026-05-01T06:00:00.000Z',
      lastStatus: 'SUCCESS',
    },
    {
      id: 'sched_weekly',
      name: 'Weekly NOC Operations',
      enabled: false,
      cadence: 'weekly',
      cronExpression: '0 6 * * 1',
      timezone: 'Asia/Kolkata',
      templateVersion: 'v2',
      recipients: ['noc@dominos.in'],
      nextRunAt: null,
      lastRunAt: '2026-05-18T06:00:00.000Z',
      lastStatus: 'FAILED',
      lastError: 'Simulated connection error',
    },
  ];

  const mockRuns = [
    {
      id: 'run_1',
      scheduleId: 'sched_monthly',
      scheduleName: 'Monthly Executive QBR',
      runAt: '2026-05-01T06:00:00.000Z',
      triggerType: 'CRON',
      cadence: 'monthly',
      period: { displayLabel: '1 April 2026 – 30 April 2026' },
      status: 'SUCCESS',
      jobId: 'job_1',
      downloadUrl: '/api/ppt/download/job_1',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. rendersMultipleSchedulesList
  it('1. rendersMultipleSchedulesList: Displays configured schedules as clickable buttons', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ manifest: { versions: [] } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, schedules: mockSchedules, runs: mockRuns }),
      });
    });

    render(
      <ScheduleManagerModal
        isOpen={true}
        onClose={vi.fn()}
        client={mockClient}
        isAdmin={true}
      />
    );

    expect(screen.getByText(/Automated QBR Scheduling & Cadence Manager/i)).toBeInTheDocument();
    expect(screen.getByText(/Jubilant Foodworks Ltd/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Monthly Executive QBR/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Weekly NOC Operations/i })).toBeInTheDocument();
    });

    // Run history table shows period
    expect(screen.getByText(/1 April 2026 – 30 April 2026/i)).toBeInTheDocument();
  });

  // 2. addScheduleButton
  it('2. addScheduleButton: Admin clicking + Add Schedule appends a new draft card', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ manifest: { versions: [] } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, schedules: mockSchedules, runs: [] }),
      });
    });

    render(
      <ScheduleManagerModal
        isOpen={true}
        onClose={vi.fn()}
        client={mockClient}
        isAdmin={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Add Schedule/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Schedule/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Scheduled QBR/i })).toBeInTheDocument();
    });
  });

  // 3. perScheduleDuplicate409
  it('3. perScheduleDuplicate409: Displays HTTP 409 duplicate warning banner when duplicate triggered', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'POST' && url.includes('/trigger')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'DUPLICATE_JOB', code: 'DUPLICATE_JOB' }),
        });
      }
      if (url.includes('/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ manifest: { versions: [] } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, schedules: mockSchedules, runs: mockRuns }),
      });
    });

    render(
      <ScheduleManagerModal
        isOpen={true}
        onClose={vi.fn()}
        client={mockClient}
        isAdmin={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /⚡ Run Now/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /⚡ Run Now/i }));

    await waitFor(() => {
      expect(screen.getByText(/DUPLICATE_JOB/i)).toBeInTheDocument();
    });
  });

  // 4. clientUserViewOnly
  it('4. clientUserViewOnly: Non-admin client users see view-only controls without mutation buttons', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ manifest: { versions: [] } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, schedules: mockSchedules, runs: mockRuns }),
      });
    });

    render(
      <ScheduleManagerModal
        isOpen={true}
        onClose={vi.fn()}
        client={mockClient}
        isAdmin={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Monthly Executive QBR/i })).toBeInTheDocument();
    });

    // Admin-only mutation buttons must not be present
    expect(screen.queryByRole('button', { name: /⚡ Run Now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /💾 Save Schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ Add Schedule/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close$/i })).toBeInTheDocument();
  });

  // 5. bootInitializingState
  it('5. bootInitializingState: Displays non-blocking initializing notice when engine is booting', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ manifest: { versions: [] } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, schedules: [], runs: [], initializing: true }),
      });
    });

    render(
      <ScheduleManagerModal
        isOpen={true}
        onClose={vi.fn()}
        client={mockClient}
        isAdmin={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/scheduler engine is currently initializing/i)).toBeInTheDocument();
    });
  });
});
