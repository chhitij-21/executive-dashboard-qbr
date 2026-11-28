// shared/types/qbr.ts
// Canonical Single Source of Truth (SSOT) TypeScript Contracts shared across Backend & Frontend.

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AuditSeverityLevel = 'INFO' | 'WARN' | 'CRITICAL';
export type AuditStatus = 'SUCCESS' | 'FAILURE';
export type ConnectorProvider = 'meraki' | 'catalyst_center' | 'generic';
export type WebhookEventStatus = 'buffered' | 'processed' | 'ignored';

export interface ReportPeriod {
  start_date?: string;
  end_date?: string;
  display_label?: string;
  quarter?: string;
  fiscal_year?: string;
  is_standard_quarter?: boolean;
  qoq_disabled_reason?: string | null;
}

export interface TenantBranding {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logo?: string;
}

export interface ClientTenant {
  id: string;
  name: string;
  code?: string;
  logo?: string;
  branding?: TenantBranding;
  settings?: {
    slaTarget?: number;
    branding?: TenantBranding;
    [key: string]: unknown;
  };
}

export interface ExecutiveSummary {
  customerName?: string;
  clientId?: string;
  totalSites?: number;
  totalDevices?: number;
  totalSwitches?: number;
  totalAPs?: number;
  totalStockDevices?: number;
  healthyDevices?: number;
  totalIncidents?: number;
  criticalIncidents?: number;
  majorIncidents?: number;
  apIncidents?: number;
  jflSwitchUptime?: number | string;
  proactiveSwitchUptime?: number | string;
  overallUptime?: number | string;
  slaCompliance?: number | string;
  slaComplianceRate?: number | string;
  slaTarget?: number;
  healthScore?: number;
  healthLabel?: string;
  primaryRcaSwitches?: string;
  primaryRcaAPs?: string;
}

export interface SiteSummaryRow {
  siteId?: string;
  Location?: string;
  site?: string;
  deviceCount?: number;
  devices?: number;
  switchCount?: number;
  switches?: number;
  apCount?: number;
  aps?: number;
  incidentCount?: number;
  jflSwitchUptime?: number | string;
  proactiveSwitchUptime?: number | string;
  overallUptime?: number | string;
  switchUptime?: number | string;
  uptime?: number | string;
  healthScore?: number;
  primaryRcaSwitches?: string;
  primaryRcaAPs?: string;
}

export interface RcaBreakdownRow {
  rca: string;
  count: number;
  percentage: string;
  isTop?: boolean;
  tied?: boolean;
}

export interface ImpactWeightedRca {
  rca: string;
  totalMinutes: number;
  percentage: string;
}

export interface DeviceClassRcaSplit {
  totalIncidents: number;
  topRca: string;
  breakdown: RcaBreakdownRow[];
}

export interface RcaAnalytics {
  totalIncidents: number;
  topRca: string;
  breakdown: RcaBreakdownRow[];
  rawBreakdown?: RcaBreakdownRow[];
  standardBreakdown?: unknown[];
  byDeviceClass?: {
    switches: DeviceClassRcaSplit;
    aps: DeviceClassRcaSplit;
  };
  impactWeighted?: ImpactWeightedRca[];
  totalOutageMinutes?: number;
}

export interface Anomaly {
  id: string;
  severity: SeverityLevel;
  type: string;
  entity: {
    site?: string;
    device?: string;
    ticket?: string;
  };
  message: string;
  evidence?: Record<string, unknown>;
  recommendation?: string;
}

export interface AnomalySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface QbrData {
  jobId?: string;
  id?: string;
  clientId?: string;
  customerName?: string;
  reportingPeriod?: string;
  report_period?: ReportPeriod | null;
  generatedAt?: string;
  executiveSummary?: ExecutiveSummary;
  siteSummary?: SiteSummaryRow[];
  switchAnalytics?: Record<string, unknown>;
  apAnalytics?: Record<string, unknown>;
  incidentAnalytics?: Record<string, unknown>;
  rcaAnalytics?: RcaAnalytics;
  slaAnalytics?: Record<string, unknown>;
  proactiveTicketAnalytics?: Record<string, unknown>;
  anomalies?: Anomaly[];
  anomalySummary?: AnomalySummary;
  devices?: Record<string, unknown>[];
  incidents?: Record<string, unknown>[];
  otherActivities?: Record<string, unknown>[];
  lineage?: Record<string, unknown>;
  qoqComparison?: Record<string, unknown> | null;
  is_standard_quarter?: boolean;
  has_prior_quarter?: boolean;
  qoq_disabled_reason?: string | null;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  event_type: string;
  severity: AuditSeverityLevel;
  tenant_id: string | null;
  user_id?: string | null;
  username?: string | null;
  role?: string | null;
  ip_address: string;
  user_agent?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  action: string;
  status: AuditStatus;
  details?: Record<string, unknown> | string;
}

export interface WebhookConnector {
  id: string;
  tenantId: string;
  provider: ConnectorProvider;
  name: string;
  secretPreview: string;
  webhookSecret?: string;
  hasSharedSecret?: boolean;
  enabled: boolean;
  lastEventAt?: string | null;
  eventCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookEvent {
  id: string;
  connectorId: string;
  tenantId: string;
  provider: ConnectorProvider | string;
  eventId?: string | null;
  eventType: string;
  severity: SeverityLevel | 'INFO';
  deviceId: string;
  deviceSerial?: string;
  deviceType: string;
  siteId: string;
  rcaHint: string;
  message: string;
  occurredAt: string;
  status: WebhookEventStatus;
  signatureVerified?: boolean;
}
