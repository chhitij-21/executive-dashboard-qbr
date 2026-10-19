// frontend/src/components/EnterpriseInsightCard.jsx
// Enterprise Executive Intelligence Briefing (Virtual CTO AI) Component
// Provides executive summary, business risks, and actionable recommendations.

import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { generateAISummary } from '../utils/aiSummaryGenerator';

/**
 * Derives instantaneous client-side fallback insights so the card renders
 * immediately with zero delay or flicker.
 */
function getClientFallbackInsights(section, data, selectedSite) {
  const exec = data?.executiveSummary || {};
  const slaTarget = Number(data?.slaAnalytics?.slaTarget ?? exec.slaTarget ?? 99.3);
  const slaCompliance = Number(exec.slaCompliance ?? exec.slaComplianceRate ?? 100);
  const switchUptime = Number(exec.jflSwitchUptime ?? exec.overallUptime ?? 100);
  const healthScore = Number(exec.healthScore ?? 100);
  const critical = Number(exec.criticalIncidents ?? (data?.incidents || []).filter(i => /p1|critical/i.test(i.Priority || i.Severity || '')).length);
  const switchRCA = exec.primaryRcaSwitches || 'Stable Operations (No Incidents)';
  const apRCA = exec.primaryRcaAPs || 'Stable Operations (No Incidents)';
  const apIncidents = Number(exec.apIncidents ?? 0);

  const summary = generateAISummary(section, data, selectedSite);

  const risks = [];
  const actions = [];

  if (slaCompliance < slaTarget) {
    risks.push(`SLA breach risk: Current SLA compliance (${slaCompliance}%) is below contractual target (${slaTarget}%).`);
  }
  if (switchUptime < slaTarget) {
    risks.push(`Switch availability risk: Core switch availability (${switchUptime}%) is operating below contractual SLA target (${slaTarget}%).`);
  }
  if (healthScore < 90) {
    risks.push(`Infrastructure health risk: Enterprise health score (${healthScore}/100) indicates elevated operational degradation.`);
  }
  if (critical > 0) {
    risks.push(`Critical incident exposure: ${critical} Priority-1 (P1) outage incidents recorded during the reporting period.`);
  }
  if (section === 'aps' && apIncidents > 0) {
    risks.push(`Wireless connectivity risk: ${apIncidents} AP incidents impacted localized store coverage and mobile ordering.`);
  }
  if (switchRCA !== 'Stable Operations (No Incidents)' && (section === 'rca' || section === 'switches' || section === 'overview' || section === 'executive')) {
    risks.push(`Root cause concentration: Primary switch downtime driver identified as ${switchRCA}.`);
  }

  if (risks.length === 0) {
    risks.push('Operational monitoring required: Ensure continuous surveillance on edge hardware and external ISP circuits.');
  }

  switch (section) {
    case 'switches':
      actions.push(`Execute preventative inspection on core switches impacted by ${switchRCA}.`);
      actions.push('Audit switch uplink redundancies and verify port auto-negotiation stability across store sites.');
      break;
    case 'aps':
      actions.push('Optimize dynamic channel allocation and transmit power on APs in high-density store zones.');
      actions.push('Verify PoE power budget thresholds on upstream switches to prevent unexpected AP reboots.');
      break;
    case 'incidents':
      actions.push('Implement automated tier-1 ticket dispatch to reduce mean time to acknowledge (MTTA).');
      actions.push('Conduct formal Post-Incident Reviews (PIR) for all P1 and breached tickets to prevent repeat occurrences.');
      break;
    case 'rca':
      actions.push(`Formulate dedicated remediation workflow addressing root causes associated with ${switchRCA}.`);
      actions.push('Align with facility engineering and external telecom providers to mitigate utility-dependent failure modes.');
      break;
    case 'sla':
      actions.push('Establish automated threshold alerts at 75% elapsed SLA resolution time to prevent ticket breaches.');
      actions.push('Standardize on-hold categorization protocols to ensure external dependencies are appropriately classified.');
      break;
    case 'sites':
      actions.push('Deploy remote UPS battery diagnostics and proactive environmental alerts across all high-incident sites.');
      actions.push('Standardize emergency replacement hardware inventory at regional logistics hubs to accelerate on-site restoration.');
      break;
    case 'other':
      actions.push('Enforce strict Change Advisory Board (CAB) review protocols prior to executing any core network updates.');
      actions.push('Require 48-hour pre-notification for all on-site third-party electrical or cabling modifications.');
      break;
    case 'overview':
    case 'executive':
    default:
      actions.push(`Initiate preventative maintenance targeting top outage driver (${switchRCA}).`);
      actions.push(`Maintain rigorous weekly SLA review to ensure performance remains above the ${slaTarget}% threshold.`);
      break;
  }

  return {
    executive_summary: summary,
    business_risks: risks,
    action_items: actions
  };
}

/**
 * EnterpriseInsightCard Component
 * Displays a clean, B2B SaaS Executive Intelligence Briefing card with CTO-grade insights.
 */
export default function EnterpriseInsightCard({
  section,
  activeTab,
  data,
  activeDashboardData,
  selectedSite,
  className = ''
}) {
  const { activeClient } = useAuth();
  const effectiveSection = section || activeTab || 'overview';
  const effectiveData = data || activeDashboardData;

  const fallback = useMemo(
    () => getClientFallbackInsights(effectiveSection, effectiveData, selectedSite),
    [effectiveSection, effectiveData, selectedSite]
  );

  const [insight, setInsight] = useState(fallback);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Synchronize immediate fallback when data/section changes
    setInsight(getClientFallbackInsights(effectiveSection, effectiveData, selectedSite));

    let isMounted = true;
    const token = localStorage.getItem('portal_token') || localStorage.getItem('token');
    const clientId = activeClient?.id || effectiveData?.clientId;

    if (!token && !clientId) return;

    setLoading(true);

    fetch(`${API_BASE_URL}/api/ai/insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        section: effectiveSection,
        clientId,
        data: effectiveData
      })
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((resData) => {
        if (!isMounted) return;
        const payload = resData.data || resData;
        if (payload?.executive_summary) {
          setInsight({
            executive_summary: payload.executive_summary,
            business_risks: Array.isArray(payload.business_risks) && payload.business_risks.length > 0
              ? payload.business_risks
              : fallback.business_risks,
            action_items: Array.isArray(payload.action_items) && payload.action_items.length > 0
              ? payload.action_items
              : fallback.action_items
          });
        }
      })
      .catch(() => {
        // Silently preserve high-fidelity fallback without breaking UI
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [effectiveSection, effectiveData, selectedSite, activeClient?.id]);

  const displaySection = useMemo(() => {
    const s = effectiveSection || 'overview';
    if (s === 'aps') return 'Access Points';
    if (s === 'rca') return 'Root Cause Analysis';
    if (s === 'sla') return 'Service Level Agreement';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [section]);

  return (
    <div
      className={`enterprise-insight-card ${className}`}
      style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border, #e2e8f0)',
          paddingBottom: '0.875rem',
          marginBottom: '1.125rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: 'var(--bg-secondary, #f1f5f9)',
              color: '#334155',
            }}
          >
            <ShieldCheck size={18} strokeWidth={2.2} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--text-primary, #0f172a)',
                  letterSpacing: '-0.01em',
                }}
              >
                Executive Intelligence Briefing
              </h3>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                }}
              >
                Virtual CTO · {displaySection}
              </span>
            </div>
          </div>
        </div>

        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted, #64748b)',
            }}
          >
            <RefreshCw size={12} className="spinning-icon" />
            <span>Analyzing</span>
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{ marginBottom: '1.25rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            lineHeight: 1.6,
            color: 'var(--text-primary, #0f172a)',
            fontWeight: 400,
          }}
        >
          {insight.executive_summary}
        </p>
      </div>

      {/* Two-Column Grid: Business Risks & Action Items */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {/* Business Risks */}
        <div
          style={{
            background: 'var(--bg-primary, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: '6px',
            padding: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginBottom: '0.625rem',
            }}
          >
            <AlertTriangle size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
            <h4
              style={{
                margin: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#dc2626',
              }}
            >
              Business Risks
            </h4>
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.375rem',
            }}
          >
            {insight.business_risks.map((risk, idx) => (
              <li
                key={idx}
                style={{
                  fontSize: '0.8125rem',
                  lineHeight: 1.5,
                  color: 'var(--text-secondary, #334155)',
                }}
              >
                {risk}
              </li>
            ))}
          </ul>
        </div>

        {/* Action Items */}
        <div
          style={{
            background: 'var(--bg-primary, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: '6px',
            padding: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginBottom: '0.625rem',
            }}
          >
            <CheckCircle2 size={15} style={{ color: '#2563eb', flexShrink: 0 }} />
            <h4
              style={{
                margin: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#2563eb',
              }}
            >
              Action Items
            </h4>
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.375rem',
            }}
          >
            {insight.action_items.map((action, idx) => (
              <li
                key={idx}
                style={{
                  fontSize: '0.8125rem',
                  lineHeight: 1.5,
                  color: 'var(--text-secondary, #334155)',
                }}
              >
                {action}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
