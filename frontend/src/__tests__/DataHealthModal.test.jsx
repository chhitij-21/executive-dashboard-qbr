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
});
