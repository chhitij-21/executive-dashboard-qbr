import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileUploader from '../components/FileUploader';

// Mock apiFetch helper
vi.mock('../config/api', () => ({
  apiFetch: vi.fn(),
  API_BASE_URL: 'http://localhost:3000',
}));

let mockAuthActiveClient = {
  id: 'client-jfl',
  name: 'Jubilant FoodWorks',
  code: 'JFL',
};

// Mock useAuth
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Operations Engineer', role: 'operator' },
    token: 'test-jwt-token',
    activeClient: mockAuthActiveClient,
    activeLocation: 'All Locations',
    clients: [
      { id: 'client-jfl', name: 'Jubilant FoodWorks', code: 'JFL' },
      { id: 'client-mmtcpamp', name: 'MMTC-PAMP India Pvt. Ltd.', code: 'MMTC' },
    ],
    isAdmin: false,
    setActiveClient: vi.fn(),
    setActiveLocation: vi.fn(),
  }),
}));

describe('FileUploader Component - Async Queue & Polling Workflow (Item #10)', () => {
  const mockClient = {
    id: 'client-jfl',
    name: 'Jubilant FoodWorks',
    code: 'JFL',
  };

  const mockUser = {
    name: 'Operations Engineer',
    role: 'operator',
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockAuthActiveClient = {
      id: 'client-jfl',
      name: 'Jubilant FoodWorks',
      code: 'JFL',
    };
  });

  it('1. Renders upload workflow with required date range and file upload inputs', () => {
    render(
      <FileUploader
        onJobStarted={vi.fn()}
        onJobCompleted={vi.fn()}
      />
    );

    expect(screen.getByText(/Report Generation Workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/Incident Excel File \(Mandatory\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Device Inventory File \(Optional\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Validate & Generate QBR Reports/i)).toBeInTheDocument();
  });

  it('2. Resumes active job polling on mount if localStorage has matching active client', async () => {
    const testJobId = 'active-test-uuid-1234';
    localStorage.setItem('active_qbr_job_id', testJobId);
    localStorage.setItem('active_qbr_job_client', 'client-jfl');
    localStorage.setItem('active_qbr_job_started_at', String(Date.now()));

    const { apiFetch } = await import('../config/api');
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        job: {
          jobId: testJobId,
          clientId: 'client-jfl',
          status: 'processing',
          progress: 45,
          stage: 'data_processing',
          message: 'Calculating site SLA and uptime metrics...',
        },
      }),
    });

    render(
      <FileUploader
        activeClient={mockClient}
        user={mockUser}
        onJobStarted={vi.fn()}
        onJobCompleted={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Progress/i)).toBeInTheDocument();
      expect(screen.getByText('45%')).toBeInTheDocument();
      expect(screen.getAllByText(/Calculating site SLA and uptime metrics/i).length).toBeGreaterThan(0);
    });
  });

  it('3. Resets localStorage job keys when user switches to a different client', async () => {
    localStorage.setItem('active_qbr_job_id', 'stale-jfl-job');
    localStorage.setItem('active_qbr_job_client', 'client-jfl');
    localStorage.setItem('active_qbr_job_started_at', String(Date.now()));

    const differentClient = {
      id: 'client-mmtcpamp',
      name: 'MMTC-PAMP India Pvt. Ltd.',
      code: 'MMTC',
    };
    mockAuthActiveClient = differentClient;

    render(
      <FileUploader
        onJobStarted={vi.fn()}
        onJobCompleted={vi.fn()}
      />
    );

    // Stale JFL job must be cleared from localStorage
    expect(localStorage.getItem('active_qbr_job_id')).toBeNull();
    expect(localStorage.getItem('active_qbr_job_client')).toBeNull();
    expect(screen.queryByText(/Progress/i)).not.toBeInTheDocument();
  });

  it('4. Allows user to cancel an active job, clearing localStorage and setting cancellation state', async () => {
    const testJobId = 'cancel-test-uuid-9999';
    localStorage.setItem('active_qbr_job_id', testJobId);
    localStorage.setItem('active_qbr_job_client', 'client-jfl');
    localStorage.setItem('active_qbr_job_started_at', String(Date.now()));

    const { apiFetch } = await import('../config/api');
    apiFetch.mockImplementation(async (url, opts) => {
      if (opts?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ success: true, message: 'Job cancelled successfully.' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          job: {
            jobId: testJobId,
            clientId: 'client-jfl',
            status: 'processing',
            progress: 30,
            stage: 'parsing_excel',
            message: 'Parsing Excel workbooks...',
          },
        }),
      };
    });

    render(
      <FileUploader
        activeClient={mockClient}
        user={mockUser}
        onJobStarted={vi.fn()}
        onJobCompleted={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/✕ Cancel Job/i)).toBeInTheDocument();
    });

    const cancelBtn = screen.getByText(/✕ Cancel Job/i);
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.getByText(/Job cancelled by user/i)).toBeInTheDocument();
      expect(localStorage.getItem('active_qbr_job_id')).toBeNull();
    });
  });
});
