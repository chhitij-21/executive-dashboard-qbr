// frontend/src/__tests__/EnterpriseAdminPanels.test.jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuditLogsPanel from '../components/AuditLogsPanel';
import ConnectorsPanel from '../components/ConnectorsPanel';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';

const mockAuthState = {
  user: { id: 'user-super-admin', name: 'Super Admin', email: 'admin@portal.com', role: 'admin' },
  isAdmin: true,
  clients: [{ id: 'client-jfl', name: 'Jubilant FoodWorks', code: 'JFL', branding: { logo: '🍕', primaryColor: '#1d4ed8' } }],
  activeClient: { id: 'client-jfl', name: 'Jubilant FoodWorks', code: 'JFL', branding: { logo: '🍕', primaryColor: '#1d4ed8' } },
  setActiveClient: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

describe('Enterprise UI Wiring: Audit Trail (#21), Connectors (#19) & API Docs (#23)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('AuditLogsPanel loads tenant audit logs, toggles All Tenants, and triggers CSV export', async () => {
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('/audit/export')) {
        return {
          ok: true,
          blob: async () => new Blob(['id,event_type\n1,AUTH_LOGIN_SUCCESS'], { type: 'text/csv' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          total: 1,
          logs: [
            {
              id: 'aud-1',
              timestamp: '2026-11-25T05:00:00Z',
              event_type: 'AUTH_LOGIN_SUCCESS',
              severity: 'INFO',
              tenant_id: 'client-jfl',
              username: 'admin@portal.com',
              role: 'admin',
              ip_address: '127.0.0.1',
              action: 'LOGIN',
              status: 'SUCCESS',
              resource_type: 'auth',
              details: { mfaRequired: false },
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();

    render(<AuditLogsPanel />);

    await waitFor(() => {
      expect(screen.getByText('AUTH_LOGIN_SUCCESS')).toBeInTheDocument();
    });
    expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/tenants/client-jfl/audit');

    // Switch to admin-wide All Tenants
    fireEvent.click(screen.getByRole('button', { name: /all tenants/i }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some((c) => c[0].includes('/api/v1/audit?'))).toBe(true);
    });

    // Click Export Compliance CSV
    fireEvent.click(screen.getByRole('button', { name: /export compliance csv/i }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some((c) => c[0].includes('/api/v1/audit/export'))).toBe(true);
    });
  });

  it('ConnectorsPanel creates connector, displays one-time secret, and loads buffered anomalies', async () => {
    const mockFetch = vi.fn(async (url, opts) => {
      if (url.includes('/api/v1/connectors') && opts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            connector: {
              id: 'conn-99',
              provider: 'meraki',
              name: 'JFL Meraki Test',
              webhookSecret: 'whsec_testsecret1234567890',
              secretPreview: 'whsec_...7890',
              enabled: true,
              eventCount: 0,
            },
          }),
        };
      }
      if (url.includes('/api/v1/webhooks/buffered-incidents')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            incidents: [
              {
                webhookEventId: 'ev-1',
                IncidentNumber: 'MER-101',
                DeviceID: 'AP-SEC70-01',
                DeviceType: 'AP',
                SiteID: 'Gurgaon Head Office',
                RCA: 'Device Power Issues',
                Priority: 'P1 - Critical',
                Subject: 'AP went down',
              },
            ],
            anomalies: [
              {
                id: 'anom-wh-1',
                severity: 'HIGH',
                type: 'CORRELATED_AP_OUTAGE',
                message: 'Correlated AP outage detected at Gurgaon Head Office.',
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          connectors: [
            {
              id: 'conn-1',
              provider: 'meraki',
              name: 'Existing Meraki',
              secretPreview: 'whsec_...abcd',
              enabled: true,
              eventCount: 3,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<ConnectorsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Existing Meraki')).toBeInTheDocument();
      expect(screen.getByText(/CORRELATED_AP_OUTAGE/i)).toBeInTheDocument();
    });

    // Provision a new connector
    const nameInput = screen.getByPlaceholderText(/Store Meraki Alerts/i);
    fireEvent.change(nameInput, { target: { value: 'JFL Meraki Test' } });
    fireEvent.click(screen.getByRole('button', { name: /create connector/i }));

    await waitFor(() => {
      expect(screen.getByTestId('one-time-webhook-secret')).toBeInTheDocument();
      expect(screen.getByText('whsec_testsecret1234567890')).toBeInTheDocument();
    });
  });

  it('Sidebar and Topbar expose IT Connectors, Security Audit Trail, and API Docs links', () => {
    render(
      <div>
        <Sidebar activeTab="overview" onTabChange={() => {}} />
        <Topbar />
      </div>
    );

    expect(screen.getByText('IT Connectors & Webhooks')).toBeInTheDocument();
    expect(screen.getByText('Security Audit Trail')).toBeInTheDocument();
    const docsLinks = screen.getAllByRole('link', { name: /api docs/i });
    expect(docsLinks.length).toBeGreaterThanOrEqual(2);
    docsLinks.forEach((link) => {
      expect(link.getAttribute('href')).toContain('/api/v1/docs');
    });
  });
});
