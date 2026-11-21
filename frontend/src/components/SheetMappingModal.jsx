// frontend/src/components/SheetMappingModal.jsx
// Interactive Sheet & Column Mapping Configuration (Item #6)

import React, { useState, useEffect } from 'react';

export default function SheetMappingModal({
  isOpen,
  onClose,
  auditResult,
  inventoryAuditResult,
  initialMapping,
  onSave,
}) {
  if (!isOpen) return null;

  const incidentSheets = auditResult?.sheetNames || [];
  const detectedIncident = auditResult?.detectedRoles?.incidentSheet || incidentSheets[0] || '';
  
  const invSheets = inventoryAuditResult?.sheetNames || auditResult?.sheetNames || [];
  const detectedLocationSheets = inventoryAuditResult?.detectedRoles?.locationSheets ||
    auditResult?.detectedRoles?.locationSheets || [];

  // State
  const [selectedIncidentSheet, setSelectedIncidentSheet] = useState(
    initialMapping?.incidentSheet || detectedIncident
  );

  const [selectedLocationSheets, setSelectedLocationSheets] = useState(
    initialMapping?.locationSheets || (detectedLocationSheets.length > 0 ? detectedLocationSheets : invSheets)
  );

  const [showColumnOverrides, setShowColumnOverrides] = useState(false);
  const [columnOverrides, setColumnOverrides] = useState(
    initialMapping?.columnOverrides || {}
  );

  // Available columns on the selected incident sheet
  const activeSheetInfo = (auditResult?.sheetsInfo || []).find(
    (s) => s.sheetName === selectedIncidentSheet
  );
  const availableColumns = activeSheetInfo?.columns || [];

  const handleToggleLocationSheet = (sheetName) => {
    setSelectedLocationSheets((prev) =>
      prev.includes(sheetName)
        ? prev.filter((s) => s !== sheetName)
        : [...prev, sheetName]
    );
  };

  const handleResetToDefaults = () => {
    setSelectedIncidentSheet(detectedIncident);
    setSelectedLocationSheets(detectedLocationSheets.length > 0 ? detectedLocationSheets : invSheets);
    setColumnOverrides({});
  };

  const handleSave = () => {
    const finalMapping = {
      incidentSheet: selectedIncidentSheet,
      locationSheets: selectedLocationSheets,
      columnOverrides: Object.keys(columnOverrides).length > 0 ? columnOverrides : undefined,
    };
    onSave(finalMapping);
    onClose();
  };

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
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-card, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              📑 Sheet & Schema Mapping Configuration
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Verify or customize how your workbook worksheets and fields map into the QBR analytical engine.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Section 1: Primary Incidents Sheet */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            Primary Incidents / Tickets Worksheet:
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={selectedIncidentSheet}
              onChange={(e) => setSelectedIncidentSheet(e.target.value)}
              className="nav-select"
              style={{ flex: 1, minWidth: '200px', fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            >
              {incidentSheets.map((name) => {
                const sInfo = (auditResult?.sheetsInfo || []).find((s) => s.sheetName === name);
                const count = sInfo ? ` (${sInfo.rowCount} rows)` : '';
                const isAuto = name === detectedIncident ? ' [Auto-Detected]' : '';
                return (
                  <option key={name} value={name}>
                    {name}{count}{isAuto}
                  </option>
                );
              })}
            </select>
            {selectedIncidentSheet === detectedIncident && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                Auto-Detected
              </span>
            )}
          </div>
        </div>

        {/* Section 2: Active Inventory Sheets */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            Active Physical Inventory Worksheets ({selectedLocationSheets.length} Selected):
          </label>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Select sheets containing live active hardware assets. Uncheck decommissioned or summary sheets.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', maxHeight: '160px', overflowY: 'auto' }}>
            {invSheets.map((sName) => {
              const checked = selectedLocationSheets.includes(sName);
              return (
                <label
                  key={sName}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.82rem',
                    color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0.25rem 0.4rem',
                    background: checked ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                    borderRadius: '4px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleLocationSheet(sName)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>{sName}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Section 3: Optional Column Overrides */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <div
            onClick={() => setShowColumnOverrides(!showColumnOverrides)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              🔧 Advanced Column Header Mappings {Object.keys(columnOverrides).length > 0 && `(${Object.keys(columnOverrides).length} Active Overrides)`}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {showColumnOverrides ? '▲ Collapse' : '▼ Expand'}
            </span>
          </div>

          {showColumnOverrides && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[
                  { key: 'ticketId', label: 'Ticket / Incident ID' },
                  { key: 'deviceId', label: 'Hardware Serial No' },
                  { key: 'rca', label: 'RCA Root Cause' },
                  { key: 'actualResolutionMin', label: 'Resolution Time (Minutes)' },
                  { key: 'holdMin', label: 'Time on Hold (Minutes)' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>
                      {label}:
                    </label>
                    <select
                      value={columnOverrides[key] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setColumnOverrides((prev) => {
                          const next = { ...prev };
                          if (val) next[key] = val;
                          else delete next[key];
                          return next;
                        });
                      }}
                      className="nav-select"
                      style={{ width: '100%', fontSize: '0.78rem', padding: '0.25rem 0.5rem' }}
                    >
                      <option value="">(Default Auto-Detect)</option>
                      {availableColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="btn btn-ghost"
            style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
          >
            Reset to Auto-Detect
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '0.35rem 0.85rem' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.35rem 1rem' }}
            >
              Apply Mapping
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
