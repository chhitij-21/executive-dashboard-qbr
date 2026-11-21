// frontend/src/components/LineageModal.jsx
// Data Lineage & KPI-to-Cell Provenance Inspector (Item #7)

import React, { useMemo } from 'react';
import { findLineageForMetric } from '../validators/lineageView';

export default function LineageModal({
  isOpen,
  onClose,
  metricKey,
  metricTitle,
  currentValue,
  lineageData,
}) {
  if (!isOpen) return null;

  const lineageEntry = useMemo(() => {
    if (!lineageData || !metricKey) return null;
    return findLineageForMetric(lineageData, metricKey);
  }, [lineageData, metricKey]);

  const sources = lineageEntry?.sources || [];
  const primarySource = sources[0];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '1rem',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            backgroundColor: '#f8fafc',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '1.1rem' }}>🔗</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                Data Lineage & Provenance
              </h3>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  backgroundColor: '#e0f2fe',
                  color: '#0369a1',
                }}
              >
                SSOT Trace
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.825rem', color: '#64748b' }}>
              Exact spreadsheet cell and formula derivation for this KPI metric
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#94a3b8',
              lineHeight: 1,
              padding: '0.25rem',
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Target Metric Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.75rem',
              padding: '1rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Audited KPI Metric
              </span>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
                {metricTitle || metricKey}
              </div>
              <code style={{ fontSize: '0.75rem', color: '#64748b', background: '#e2e8f0', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                {metricKey}
              </code>
            </div>
            {currentValue !== undefined && currentValue !== null && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                  Current Value
                </span>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#2563eb' }}>
                  {String(currentValue)}
                </div>
              </div>
            )}
          </div>

          {lineageEntry ? (
            <>
              {/* Provenance Trail Card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Origin & Source Coordinates
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>SOURCE FILE</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem', wordBreak: 'break-all' }}>
                      📄 {primarySource?.file || 'Workbook SSOT'}
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>WORKSHEET TAB</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#2563eb', marginTop: '0.2rem' }}>
                      📑 {primarySource?.sheet || 'Aggregated'}
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>CELL / ROW REF</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#059669', marginTop: '0.2rem' }}>
                      🎯 {primarySource?.cellCoordinates?.cellRef ||
                          (primarySource?.row !== undefined ? `Row ${primarySource.row}` :
                          (primarySource?.contributingRows?.length ? `${primarySource.contributingRows.length} rows` : 'Range SSOT'))}
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>AGGREGATION</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#7c3aed', marginTop: '0.2rem' }}>
                      ⚡ {primarySource?.aggregationType || 'CALCULATION'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Formula & Calculation Card */}
              {primarySource?.formula && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Applied Mathematical Formula
                  </label>
                  <div
                    style={{
                      background: '#0f172a',
                      color: '#38bdf8',
                      borderRadius: '0.5rem',
                      padding: '0.85rem 1rem',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      overflowX: 'auto',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
                    }}
                  >
                    <code>{primarySource.formula}</code>
                  </div>
                </div>
              )}

              {/* Input Variables */}
              {primarySource?.inputs && primarySource.inputs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Formula Inputs & Pre-Conditions
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {primarySource.inputs.map((inp, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: '0.75rem',
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '0.25rem 0.6rem',
                          color: '#334155',
                          fontWeight: 600,
                        }}
                      >
                        📌 {inp}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Contributing Rows / Devices */}
              {primarySource?.contributingRows && primarySource.contributingRows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Contributing Excel Rows ({primarySource.contributingRows.length})
                    </label>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Validated row indexes in workbook
                    </span>
                  </div>
                  <div
                    style={{
                      maxHeight: '110px',
                      overflowY: 'auto',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      padding: '0.5rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.3rem',
                    }}
                  >
                    {primarySource.contributingRows.slice(0, 50).map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: '0.7rem',
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          padding: '0.15rem 0.4rem',
                          color: '#0f172a',
                          fontFamily: 'monospace',
                        }}
                      >
                        Row #{r}
                      </span>
                    ))}
                    {primarySource.contributingRows.length > 50 && (
                      <span style={{ fontSize: '0.7rem', color: '#64748b', alignSelf: 'center', paddingLeft: '0.3rem' }}>
                        +{primarySource.contributingRows.length - 50} more rows
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: '0.75rem',
                padding: '1.25rem',
                color: '#92400e',
                fontSize: '0.875rem',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Lineage Trace Initializing</div>
              Lineage data for <code>{metricKey}</code> is calculated continuously from the active SSOT dataset. No static overrides detected.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}

