// frontend/src/components/ScheduleManagerModal.jsx
// Enterprise Scheduled QBR & Cadence Manager Modal Dialog
// Supports multi-schedules per tenant, template version pinning, timezone selector,
// optimistic locking, and execution run history.

import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';

const CADENCE_OPTIONS = [
  {
    id: 'monthly',
    label: 'Monthly Cadence',
    cron: '0 6 1 * *',
    desc: 'Runs at 06:00 on the 1st day of every month for the previous calendar month.',
    badge: 'Standard Monthly',
  },
  {
    id: 'quarterly',
    label: 'Quarterly Cadence',
    cron: '0 6 1 1,4,7,10 *',
    desc: 'Runs at 06:00 on Jan 1, Apr 1, Jul 1, Oct 1 for the previous calendar quarter.',
    badge: 'Quarterly Executive',
  },
  {
    id: 'weekly',
    label: 'Weekly Cadence',
    cron: '0 6 * * 1',
    desc: 'Runs at 06:00 every Monday for the preceding 7-day operational window.',
    badge: 'Weekly Ops',
  },
  {
    id: 'custom',
    label: 'Custom Cron Expression',
    cron: '0 6 1 * *',
    desc: 'Custom 5-field cron (daily or slower, >= 24h frequency).',
    badge: 'Custom',
  },
];

export default function ScheduleManagerModal({ isOpen, onClose, client, isAdmin }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const [schedules, setSchedules] = useState([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [runs, setRuns] = useState([]);
  const [templateVersions, setTemplateVersions] = useState([]);
  const [newRecipient, setNewRecipient] = useState('');
  const [tzSearch, setTzSearch] = useState('');

  // Active schedule being inspected/edited
  const activeSchedule = useMemo(() => {
    if (!schedules.length) return null;
    return schedules.find((s) => s.id === selectedScheduleId) || schedules[0];
  }, [schedules, selectedScheduleId]);

  // System supported timezones
  const supportedTimezones = useMemo(() => {
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('timeZone');
      }
    } catch (_) {}
    return ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Asia/Dubai'];
  }, []);

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return supportedTimezones;
    const q = tzSearch.toLowerCase();
    return supportedTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [supportedTimezones, tzSearch]);

  const loadSchedulesAndTemplates = async () => {
    if (!client) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch Schedules
      const schedRes = await apiFetch(`${API_BASE_URL}/api/tenants/${encodeURIComponent(client.id)}/schedules`);
      if (schedRes.ok) {
        const body = await schedRes.json();
        setIsInitializing(Boolean(body.initializing));
        const schedList = Array.isArray(body.schedules) ? body.schedules : [];
        setSchedules(schedList);
        if (schedList.length > 0 && !selectedScheduleId) {
          setSelectedScheduleId(schedList[0].id);
        }
        if (Array.isArray(body.runs)) {
          setRuns(body.runs);
        }
      } else {
        const errBody = await schedRes.json().catch(() => ({}));
        setErrorMsg(errBody.error || `Failed to fetch schedules (HTTP ${schedRes.status})`);
      }

      // 2. Fetch Templates Manifest for Version Pinning Dropdown
      const tplRes = await apiFetch(`${API_BASE_URL}/api/tenants/${encodeURIComponent(client.id)}/templates`);
      if (tplRes.ok) {
        const tplBody = await tplRes.json();
        const vers = tplBody.manifest?.versions || [];
        setTemplateVersions(vers);
      }
    } catch (err) {
      setErrorMsg('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && client) {
      loadSchedulesAndTemplates();
    }
  }, [isOpen, client]);

  if (!isOpen || !client) return null;

  const handleCreateNewSchedule = () => {
    if (!isAdmin) return;
    const newDraft = {
      id: `draft_${Date.now()}`,
      name: 'New Scheduled QBR',
      enabled: true,
      cadence: 'monthly',
      cronExpression: '0 6 1 * *',
      timezone: 'Asia/Kolkata',
      templateVersion: 'latest',
      recipients: [],
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null,
      lastError: null,
      updatedAt: null,
      isDraft: true,
    };
    setSchedules((prev) => [...prev, newDraft]);
    setSelectedScheduleId(newDraft.id);
  };

  const handleUpdateActiveField = (field, value) => {
    if (!isAdmin || !activeSchedule) return;
    setSchedules((prev) =>
      prev.map((s) => (s.id === activeSchedule.id ? { ...s, [field]: value } : s))
    );
  };

  const handleSaveSchedule = async () => {
    if (!isAdmin || !activeSchedule) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        ...activeSchedule,
        // If draft, do not send draft id so server creates server-side UUID
        id: activeSchedule.isDraft ? undefined : activeSchedule.id,
      };

      const res = await apiFetch(`${API_BASE_URL}/api/tenants/${encodeURIComponent(client.id)}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMsg(`Schedule "${body.schedule?.name || activeSchedule.name}" saved successfully.`);
        await loadSchedulesAndTemplates();
        if (body.schedule) {
          setSelectedScheduleId(body.schedule.id);
        }
      } else {
        if (res.status === 409) {
          setErrorMsg('SCHEDULE_VERSION_CONFLICT: Another admin modified this schedule. Please reload.');
        } else {
          setErrorMsg(body.error || 'Failed to save schedule.');
        }
      }
    } catch (err) {
      setErrorMsg('Failed to save schedule: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerRunNow = async () => {
    if (!isAdmin || !activeSchedule) return;
    setTriggering(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch(
        `${API_BASE_URL}/api/tenants/${encodeURIComponent(client.id)}/schedules/${encodeURIComponent(activeSchedule.id)}/trigger`,
        { method: 'POST' }
      );

      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMsg('Ad-hoc report generation executed successfully.');
        if (body.run) {
          setRuns((prev) => [body.run, ...prev]);
        }
        await loadSchedulesAndTemplates();
      } else {
        if (res.status === 409) {
          setErrorMsg('DUPLICATE_JOB: A report for this cadence and period was already generated or is currently executing.');
        } else if (res.status === 429) {
          setErrorMsg('RATE_LIMIT_EXCEEDED: Maximum 5 ad-hoc triggers per minute permitted. Please wait before retrying.');
        } else {
          setErrorMsg(body.error || 'Run Now execution failed.');
        }
      }
    } catch (err) {
      setErrorMsg('Failed to execute Run Now: ' + err.message);
    } finally {
      setTriggering(false);
    }
  };

  const handleDeleteSchedule = async () => {
    if (!isAdmin || !activeSchedule) return;
    if (activeSchedule.isDraft) {
      setSchedules((prev) => prev.filter((s) => s.id !== activeSchedule.id));
      setSelectedScheduleId(schedules[0]?.id || null);
      return;
    }

    if (!window.confirm(`Are you sure you want to delete schedule "${activeSchedule.name}"?`)) {
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(
        `${API_BASE_URL}/api/tenants/${encodeURIComponent(client.id)}/schedules/${encodeURIComponent(activeSchedule.id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setSuccessMsg('Schedule deleted successfully.');
        await loadSchedulesAndTemplates();
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || 'Failed to delete schedule.');
      }
    } catch (err) {
      setErrorMsg('Error deleting schedule: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRecipient = (e) => {
    e.preventDefault();
    const clean = newRecipient.trim();
    if (!clean || !activeSchedule) return;
    const cur = activeSchedule.recipients || [];
    if (!cur.includes(clean)) {
      handleUpdateActiveField('recipients', [...cur, clean]);
    }
    setNewRecipient('');
  };

  const handleRemoveRecipient = (emailToRemove) => {
    if (!isAdmin || !activeSchedule) return;
    const cur = activeSchedule.recipients || [];
    handleUpdateActiveField('recipients', cur.filter((e) => e !== emailToRemove));
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="modal-content"
        style={{
          width: '920px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          padding: '1.5rem',
          background: '#ffffff',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.85rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              📅 Automated QBR Scheduling &amp; Cadence Manager
            </h2>
            <div style={{ fontSize: '0.825rem', color: '#64748b', marginTop: '0.2rem' }}>
              Client: <strong style={{ color: '#1e293b' }}>{client.name}</strong> ({client.id})
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#64748b',
              lineHeight: 1,
            }}
            title="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Notices */}
        {isInitializing && (
          <div style={{ padding: '0.65rem 0.85rem', background: '#eff6ff', color: '#1e40af', borderRadius: '6px', fontSize: '0.825rem', margin: '0.75rem 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⏳</span>
            <span>The scheduler engine is currently initializing standing schedules across clusters. Controls will become active momentarily.</span>
          </div>
        )}

        {errorMsg && (
          <div style={{ padding: '0.65rem 0.85rem', background: '#fef2f2', color: '#991b1b', borderRadius: '6px', fontSize: '0.825rem', margin: '0.75rem 0 0', border: '1px solid #fecaca' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {successMsg && (
          <div style={{ padding: '0.65rem 0.85rem', background: '#f0fdf4', color: '#166534', borderRadius: '6px', fontSize: '0.825rem', margin: '0.75rem 0 0', border: '1px solid #bbf7d0' }}>
            ✅ {successMsg}
          </div>
        )}

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Schedule Selector & Add Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#475569' }}>Schedules:</span>
              {schedules.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedScheduleId(s.id)}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: s.id === activeSchedule?.id ? '#2563eb' : '#cbd5e1',
                    background: s.id === activeSchedule?.id ? '#eff6ff' : '#ffffff',
                    color: s.id === activeSchedule?.id ? '#1d4ed8' : '#475569',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.enabled ? '#22c55e' : '#94a3b8' }}></span>
                  {s.name}
                  {s.lastStatus === 'FAILED' && <span title="Last run failed">🔴</span>}
                </button>
              ))}
              {schedules.length === 0 && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No schedules configured</span>}
            </div>

            {isAdmin && (
              <button
                onClick={handleCreateNewSchedule}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Add Schedule
              </button>
            )}
          </div>

          {activeSchedule && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Schedule Title & Enable Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1, marginRight: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Schedule Name
                  </label>
                  <input
                    type="text"
                    disabled={!isAdmin}
                    value={activeSchedule.name || ''}
                    onChange={(e) => handleUpdateActiveField('name', e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '0.2rem' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={Boolean(activeSchedule.enabled)}
                      onChange={(e) => handleUpdateActiveField('enabled', e.target.checked)}
                      style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                    />
                    Enable Automated Execution
                  </label>
                </div>
              </div>

              {/* Cadence Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                  Cadence &amp; Recurrence Model
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                  {CADENCE_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      onClick={() => isAdmin && handleUpdateActiveField('cadence', opt.id)}
                      style={{
                        padding: '0.65rem',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: activeSchedule.cadence === opt.id ? '#3b82f6' : '#e2e8f0',
                        background: activeSchedule.cadence === opt.id ? '#f0f9ff' : '#f8fafc',
                        cursor: isAdmin ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>{opt.label}</span>
                        <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: '#e2e8f0', color: '#475569' }}>
                          {opt.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.3rem', lineHeight: 1.3 }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom Cron Input */}
              {activeSchedule.cadence === 'custom' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Custom Cron Expression (5 Fields, &gt;= 24h Frequency)
                  </label>
                  <input
                    type="text"
                    disabled={!isAdmin}
                    value={activeSchedule.cronExpression || ''}
                    onChange={(e) => handleUpdateActiveField('cronExpression', e.target.value)}
                    placeholder="e.g. 0 6 1 * *"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', fontFamily: 'monospace', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '0.2rem' }}
                  />
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                    Sub-daily cron schedules (e.g. hourly or minute-interval) are strictly rejected to prevent server OOM.
                  </div>
                </div>
              )}

              {/* Grid: Template Version & Timezone */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Template Version Dropdown (Item #11 Integration) */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Template Version Pinning
                  </label>
                  <select
                    disabled={!isAdmin}
                    value={activeSchedule.templateVersion || 'latest'}
                    onChange={(e) => handleUpdateActiveField('templateVersion', e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '0.2rem', background: '#ffffff' }}
                  >
                    <option value="latest">Latest Active Template (Auto-Update)</option>
                    {templateVersions.map((v) => (
                      <option key={v.versionId} value={v.versionId}>
                        Pinned: {v.versionId} — {v.originalFilename || 'Uploaded Template'} ({v.createdAt ? new Date(v.createdAt).toLocaleDateString() : 'Active'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Timezone Dropdown */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Execution Timezone (IANA)
                  </label>
                  <select
                    disabled={!isAdmin}
                    value={activeSchedule.timezone || 'Asia/Kolkata'}
                    onChange={(e) => handleUpdateActiveField('timezone', e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '0.2rem', background: '#ffffff' }}
                  >
                    {supportedTimezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Alert Recipients */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                  Failure &amp; Completion Alert Recipients
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  {(activeSchedule.recipients || []).map((email) => (
                    <span
                      key={email}
                      style={{
                        background: '#f1f5f9',
                        color: '#334155',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      {email}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRecipient(email)}
                          style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))}
                  {(activeSchedule.recipients || []).length === 0 && (
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No alert emails configured.</span>
                  )}
                </div>

                {isAdmin && (
                  <form onSubmit={handleAddRecipient} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="email"
                      value={newRecipient}
                      onChange={(e) => setNewRecipient(e.target.value)}
                      placeholder="Add recipient email (e.g. cio@dominos.in)"
                      style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.825rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                    <button
                      type="submit"
                      style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '0.825rem', cursor: 'pointer' }}
                    >
                      Add
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* Execution History */}
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#0f172a' }}>
              Execution Run History &amp; Audit Trail
            </h3>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Run Timestamp</th>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Schedule</th>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Trigger</th>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Derived Period</th>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Status</th>
                    <th style={{ padding: '0.5rem 0.65rem' }}>Artifacts</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.45rem 0.65rem', color: '#334155' }}>
                        {r.runAt ? new Date(r.runAt).toLocaleString() : 'N/A'}
                      </td>
                      <td style={{ padding: '0.45rem 0.65rem', color: '#475569' }}>
                        {r.scheduleName || r.scheduleId || 'Default'}
                      </td>
                      <td style={{ padding: '0.45rem 0.65rem', color: '#475569' }}>
                        {r.triggerType === 'MANUAL' ? '⚡ Ad-Hoc' : '⏰ Scheduled Cron'}
                      </td>
                      <td style={{ padding: '0.45rem 0.65rem', color: '#1e293b', fontWeight: 500 }}>
                        {r.period?.displayLabel || r.cadence}
                      </td>
                      <td style={{ padding: '0.45rem 0.65rem' }}>
                        <span
                          style={{
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontWeight: 600,
                            fontSize: '0.72rem',
                            background:
                              r.status === 'SUCCESS'
                                ? '#dcfce7'
                                : r.status === 'FAILED'
                                ? '#fee2e2'
                                : r.status === 'PENDING'
                                ? '#fef9c3'
                                : '#f1f5f9',
                            color:
                              r.status === 'SUCCESS'
                                ? '#166534'
                                : r.status === 'FAILED'
                                ? '#991b1b'
                                : r.status === 'PENDING'
                                ? '#854d0e'
                                : '#475569',
                          }}
                        >
                          {r.status}
                        </span>
                        {r.error && (
                          <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.15rem' }}>
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.45rem 0.65rem' }}>
                        {r.jobId ? (
                          <a
                            href={`${API_BASE_URL}/api/ppt/download/${r.jobId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
                          >
                            Download PPT
                          </a>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
                        No execution records found for this client.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '0.85rem' }}>
          <div>
            {isAdmin && activeSchedule && (
              <button
                onClick={handleDeleteSchedule}
                disabled={saving || triggering}
                style={{
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🗑️ Delete Schedule
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {isAdmin && activeSchedule && (
              <>
                <button
                  onClick={handleTriggerRunNow}
                  disabled={triggering || saving || isInitializing}
                  style={{
                    background: '#f0fdf4',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.825rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Trigger immediate ad-hoc report generation"
                >
                  {triggering ? 'Executing...' : '⚡ Run Now'}
                </button>
                <button
                  onClick={handleSaveSchedule}
                  disabled={saving || triggering || isInitializing}
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.4rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.825rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : '💾 Save Schedule'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
