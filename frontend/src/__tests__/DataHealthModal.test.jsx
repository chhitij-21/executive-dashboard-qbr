import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DataHealthModal from '../components/DataHealthModal';

describe('DataHealthModal Component (Item #12)', () => {
  const mockQbrData = {
    executiveSummary: {
      totalDevices: 145,
      totalIncidents: 4,
    },
  };

  it('renders modal with title, tabs, and export buttons when open', () => {
    render(
      <DataHealthModal
        isOpen={true}
        onClose={vi.fn()}
        qbrData={mockQbrData}
      />
    );

    expect(screen.getByText(/Data Quality & Invariant Health Audit/i)).toBeInTheDocument();
    expect(screen.getByText(/Export Excel \(\.xlsx\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Export PDF \(\.pdf\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invariant Rules/i })).toBeInTheDocument();
  });

  it('switches between tabs on click', () => {
    render(
      <DataHealthModal
        isOpen={true}
        onClose={vi.fn()}
        qbrData={mockQbrData}
      />
    );

    const issuesTabBtn = screen.getByRole('button', { name: /Data Hygiene & Warnings/i });
    fireEvent.click(issuesTabBtn);
    expect(screen.getByText(/Click any warning item below/i)).toBeInTheDocument();

    const recsTabBtn = screen.getByRole('button', { name: /Recommendations/i });
    fireEvent.click(recsTabBtn);
    expect(screen.getByText(/Operational checklist generated for NOC operators/i)).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <DataHealthModal
        isOpen={false}
        onClose={vi.fn()}
        qbrData={mockQbrData}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('resets selected issue and row snapshot cache when activeJobId changes (dataset refresh)', async () => {
    const mockHealthWithIssues = {
      status: 'WARNING',
      score: 85,
      invariants: { total: 5, passed: 5, failed: 0, checks: [] },
      metrics: { inventoryCompleteness: 90, incidentHygiene: 90, anomaliesCount: 1 },
      issues: [
        {
          id: 'dev_1_MISSING_SERIAL',
          severity: 'HIGH',
          sheetName: 'Inventory',
          rowNumber: 12,
          fieldName: 'Serial Number',
          rawValue: null,
          message: 'Device missing Serial Number',
        },
      ],
      recommendations: [],
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/v1/data-health/issue/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sheetName: 'Inventory',
            rowNumber: 12,
            rowSnapshot: { Hostname: 'Switch-01', Serial: 'UNKNOWN' },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, health: mockHealthWithIssues }),
      });
    });

    const { rerender } = render(
      <DataHealthModal
        isOpen={true}
        onClose={vi.fn()}
        qbrData={mockQbrData}
        activeJobId="job_initial"
      />
    );

    // Navigate to Issues tab
    const issuesTabBtn = screen.getByRole('button', { name: /Data Hygiene & Warnings/i });
    fireEvent.click(issuesTabBtn);

    // Wait for issue item to render
    await waitFor(() => {
      expect(screen.getByText(/Device missing Serial Number/i)).toBeInTheDocument();
    });

    // Click issue to lazy-load preview
    fireEvent.click(screen.getByText(/Device missing Serial Number/i));

    // Verify snapshot fetch called with ?jobId=job_initial
    await waitFor(() => {
      const issueCall = global.fetch.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('/api/v1/data-health/issue/')
      );
      expect(issueCall).toBeDefined();
      expect(issueCall[0]).toContain('jobId=job_initial');
    });

    // Rerender with new activeJobId (dataset refreshed to job_refreshed)
    rerender(
      <DataHealthModal
        isOpen={true}
        onClose={vi.fn()}
        qbrData={mockQbrData}
        activeJobId="job_refreshed"
      />
    );

    // Verify preview table is cleared/reset upon activeJobId change
    await waitFor(() => {
      expect(screen.queryByText(/Raw Row Snapshot/i)).not.toBeInTheDocument();
    });
  });
});
