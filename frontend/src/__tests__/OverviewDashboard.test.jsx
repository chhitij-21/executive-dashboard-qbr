import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OverviewDashboard from '../components/OverviewDashboard';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  ReferenceLine: () => null,
  Legend: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  PieChart: ({ children }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
}));

describe('OverviewDashboard Component - QoQ Toggle & State Guard', () => {
  const mockQbrData = {
    clientId: 'client-jfl',
    customerName: 'Jubilant FoodWorks',
    is_standard_quarter: true,
    has_prior_quarter: true,
    report_period: {
      quarter: 'Q2',
      fiscal_year: 'FY2027',
      display_label: '1 Jul 2026 – 30 Sep 2026',
      is_standard_quarter: true,
    },
    executiveSummary: {
      totalDevices: 145,
      healthyDevices: 145,
      totalIncidents: 4,
      slaCompliance: 99.8,
      healthScore: 98,
    },
    qoqComparison: {
      is_standard_quarter: true,
      has_prior_quarter: true,
      priorPeriod: 'Q1 FY2027',
      kpis: {
        totalIncidents: {
          current: 4,
          prior: 10,
          delta: -6,
          direction: 'improved',
          formattedDelta: '-6',
          sparkline: [{ period: 'Q1', value: 10 }, { period: 'Q2', value: 4 }],
        },
        healthScore: {
          current: 98,
          prior: 95,
          delta: 3,
          direction: 'improved',
          formattedDelta: '+3',
          sparkline: [{ period: 'Q1', value: 95 }, { period: 'Q2', value: 98 }],
        },
        slaCompliance: {
          current: 99.8,
          prior: 98.2,
          delta: 1.6,
          direction: 'improved',
          formattedDelta: '+1.6',
          sparkline: [{ period: 'Q1', value: 98.2 }, { period: 'Q2', value: 99.8 }],
        },
      },
      rcaShifts: [
        {
          category: 'Power Issue',
          priorCount: 5,
          currentCount: 1,
          delta: -4,
          pctChange: -80,
          changeLabel: '-80%',
          direction: 'improved',
        },
      ],
      siteComparisons: {},
    },
  };

  it('resets QoQ toggle to false when activeClientId changes', () => {
    const { rerender } = render(
      <OverviewDashboard
        data={mockQbrData}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    const toggle = screen.getByRole('switch', { name: /compare to previous quarter/i });
    expect(toggle.checked).toBe(false);

    // Turn toggle ON
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    // Switch client to client-mmtcpamp
    rerender(
      <OverviewDashboard
        data={{ ...mockQbrData, clientId: 'client-mmtcpamp' }}
        onNavigate={() => {}}
        activeClientId="client-mmtcpamp"
      />
    );

    // Toggle must have reset to false
    expect(toggle.checked).toBe(false);
  });

  it('disables the QoQ toggle when report is not a standard quarter', () => {
    const customData = {
      ...mockQbrData,
      is_standard_quarter: false,
      has_prior_quarter: false,
      qoq_disabled_reason: 'QoQ comparison is only available for standard quarterly periods.',
    };

    render(
      <OverviewDashboard
        data={customData}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    const toggle = screen.getByRole('switch', { name: /compare to previous quarter/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/QoQ comparison is only available for standard quarterly periods/i)).toBeInTheDocument();
  });

  it('renders inline delta badges when QoQ is toggled on', () => {
    render(
      <OverviewDashboard
        data={mockQbrData}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    const toggle = screen.getByRole('switch', { name: /compare to previous quarter/i });
    fireEvent.click(toggle);

    // Badges should now appear
    expect(screen.getByText(/▲ -6/i)).toBeInTheDocument();
    expect(screen.getByText(/▲ \+1.6%/i)).toBeInTheDocument();
  });

  it('opens and closes the QoQ breakdown modal', () => {
    render(
      <OverviewDashboard
        data={mockQbrData}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    const modalBtn = screen.getByRole('button', { name: /full qoq breakdown/i });
    fireEvent.click(modalBtn);

    expect(screen.getByText(/Quarter-over-Quarter Performance Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/Power Issue/i)).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /^close$/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/Quarter-over-Quarter Performance Analysis/i)).not.toBeInTheDocument();
  });

  it('renders the Executive Workspace Hero Banner with customer name and period (Item #17)', () => {
    render(
      <OverviewDashboard
        data={mockQbrData}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    expect(screen.getByTestId('executive-workspace-hero')).toBeInTheDocument();
    expect(screen.getByText(/Jubilant FoodWorks/i)).toBeInTheDocument();
    expect(screen.getByText(/1 Jul 2026 – 30 Sep 2026/i)).toBeInTheDocument();
  });

  it('renders Site SLA Performance Distribution card and Export PPTX button (Item #17 & #18)', () => {
    const dataWithSites = {
      ...mockQbrData,
      siteSummary: [
        { siteId: 'Site-Alpha', jflSwitchUptime: 99.8, devices: 10 },
        { siteId: 'Site-Beta', jflSwitchUptime: 98.5, devices: 8 },
      ],
    };

    render(
      <OverviewDashboard
        data={dataWithSites}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    expect(screen.getByTestId('site-sla-distribution-card')).toBeInTheDocument();
    expect(screen.getByText(/Site SLA Uptime vs Target/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export executive pptx/i })).toBeInTheDocument();
  });

  it('renders Temporal Anomalies and Impact-Weighted RCA Cards when present (Item #20 UI)', () => {
    const dataWithAnomalies = {
      ...mockQbrData,
      anomalies: [
        {
          id: 'anom-1',
          severity: 'CRITICAL',
          type: 'DEVICE_FLAPPING',
          entity: { site: 'Mumbai', device: 'SW-MUM-01' },
          message: 'Device SW-MUM-01 experienced flapping behavior (5 incidents recorded).',
          recommendation: 'Inspect uplink cabling.',
        },
        {
          id: 'anom-2',
          severity: 'HIGH',
          type: 'CORRELATED_AP_OUTAGE',
          entity: { site: 'Okhla' },
          message: '2 distinct access points failed within 15 minutes.',
          recommendation: 'Check PoE budget.',
        },
      ],
      anomalySummary: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
      rcaAnalytics: {
        impactWeighted: [
          { rca: 'ISP Issues', totalMinutes: 1200, percentage: '75.0%' },
          { rca: 'Device Power Issues', totalMinutes: 400, percentage: '25.0%' },
        ],
        byDeviceClass: {
          switches: { totalIncidents: 3, topRca: 'ISP Issues' },
          aps: { totalIncidents: 2, topRca: 'Device Power Issues' },
        },
      },
    };

    render(
      <OverviewDashboard
        data={dataWithAnomalies}
        onNavigate={() => {}}
        activeClientId="client-jfl"
      />
    );

    expect(screen.getByTestId('anomalies-rca-intelligence')).toBeInTheDocument();
    expect(screen.getByText(/Operational Anomaly Intelligence \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/1200 min \(75\.0%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Switch Top RCA \(3\)/i)).toBeInTheDocument();

    // Filter to CRITICAL hides HIGH anomaly
    fireEvent.click(screen.getByRole('button', { name: 'CRITICAL' }));
    expect(screen.getByText(/DEVICE_FLAPPING/i)).toBeInTheDocument();
    expect(screen.queryByText(/CORRELATED_AP_OUTAGE/i)).not.toBeInTheDocument();
  });
});
