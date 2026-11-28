// shared/schemas/qbrSchemas.ts
// Runtime Zod contracts shared across API validation and TypeScript UI layers.

import { z } from 'zod';

export const SeverityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const AuditSeverityEnum = z.enum(['INFO', 'WARN', 'CRITICAL']);
export const ConnectorProviderEnum = z.enum(['meraki', 'catalyst_center', 'generic']);

export const DateRangeSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  })
  .refine((val) => val.start_date <= val.end_date, {
    message: 'start_date must be on or before end_date',
    path: ['end_date'],
  });

export const AnomalySchema = z.object({
  id: z.string().min(1),
  severity: SeverityEnum,
  type: z.string().min(1),
  entity: z.object({
    site: z.string().optional(),
    device: z.string().optional(),
    ticket: z.string().optional(),
  }),
  message: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
  recommendation: z.string().optional(),
});

export const AnomalySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
});

export const ImpactWeightedRcaSchema = z.object({
  rca: z.string().min(1),
  totalMinutes: z.number().nonnegative(),
  percentage: z.string().regex(/^\d+(\.\d+)?%$/),
});

export const WebhookConnectorCreateSchema = z.object({
  clientId: z.string().min(1).optional(),
  provider: ConnectorProviderEnum,
  name: z.string().trim().min(1, 'Connector name is required').max(120),
  sharedSecret: z.string().min(8).max(256).optional(),
});

export const AuditQuerySchema = z.object({
  tenantId: z.string().optional(),
  eventType: z.string().optional(),
  severity: AuditSeverityEnum.optional(),
  action: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILURE']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ValidatedAnomaly = z.infer<typeof AnomalySchema>;
export type ValidatedConnectorCreate = z.infer<typeof WebhookConnectorCreateSchema>;
export type ValidatedAuditQuery = z.infer<typeof AuditQuerySchema>;
export type ValidatedDateRange = z.infer<typeof DateRangeSchema>;
