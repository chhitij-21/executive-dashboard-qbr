// frontend/src/components/DashboardSkeleton.jsx
import React from 'react';

/**
 * DashboardSkeleton — Reusable shimmer skeleton loader mimicking the Executive Dashboard layout:
 * - AI Summary Panel placeholder
 * - KPI Metric Cards grid placeholder
 */
export default function DashboardSkeleton() {
  const kpiCount = 12;

  return (
    <div className="dashboard-skeleton" style={{ width: '100%', padding: '0.5rem 0' }}>
      <style>{`
        @keyframes shimmer-sweep {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
        .shimmer-block {
          background: linear-gradient(
            90deg,
            rgba(226, 232, 240, 0.6) 25%,
            rgba(241, 245, 249, 0.9) 50%,
            rgba(226, 232, 240, 0.6) 75%
          );
          background-size: 200% 100%;
          animation: shimmer-sweep 1.6s infinite ease-in-out;
          border-radius: 6px;
        }
        .dark .shimmer-block {
          background: linear-gradient(
            90deg,
            rgba(30, 41, 59, 0.6) 25%,
            rgba(51, 65, 85, 0.8) 50%,
            rgba(30, 41, 59, 0.6) 75%
          );
          background-size: 200% 100%;
        }
        .skeleton-kpi-card {
          background: var(--bg-card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 10px;
          padding: 1.25rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }
      `}</style>

      {/* Hero Banner Skeleton */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="shimmer-block" style={{ height: '24px', width: '280px', marginBottom: '0.6rem' }} />
          <div className="shimmer-block" style={{ height: '14px', width: '420px', maxWidth: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="shimmer-block" style={{ height: '28px', width: '120px', borderRadius: '999px' }} />
          <div className="shimmer-block" style={{ height: '28px', width: '110px', borderRadius: '999px' }} />
        </div>
      </div>

      {/* AI Summary Panel Skeleton */}
      <div style={{
        background: 'rgba(240, 249, 255, 0.5)',
        border: '1px solid #bae6fd',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div className="shimmer-block" style={{ height: '18px', width: '180px' }} />
          <div className="shimmer-block" style={{ height: '20px', width: '130px', borderRadius: '999px' }} />
        </div>
        <div className="shimmer-block" style={{ height: '14px', width: '96%', marginBottom: '0.5rem' }} />
        <div className="shimmer-block" style={{ height: '14px', width: '92%', marginBottom: '0.5rem' }} />
        <div className="shimmer-block" style={{ height: '14px', width: '78%' }} />
      </div>

      {/* KPI Section Title Skeleton */}
      <div style={{ marginBottom: '1rem' }}>
        <div className="shimmer-block" style={{ height: '18px', width: '220px' }} />
      </div>

      {/* KPI Grid Skeleton */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {Array.from({ length: kpiCount }).map((_, i) => (
          <div key={i} className="skeleton-kpi-card">
            <div className="shimmer-block" style={{ height: '12px', width: '65%' }} />
            <div className="shimmer-block" style={{ height: '28px', width: '45%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
