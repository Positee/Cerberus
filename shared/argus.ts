/**
 * Argus.
 *
 * Uptime monitoring. A monitor tracks one endpoint. A heartbeat records one
 * probe result. The prober fires probes on a timer and writes heartbeats.
 */

export type MonitorStatus = 'up' | 'down' | 'degraded' | 'pending';

export type Monitor = {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string> | null;
  body: string | null;
  bodyEncoding: string;
  expectedStatusCodes: number[];
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  retryIntervalSeconds: number;
  monitorGroup: string | null;
  certExpiryCheck: boolean;
  upsideDownMode: boolean;
  maxRedirects: number;
  active: boolean;
  tags: string[];
  contactPointId: string | null;
  currentStatus: MonitorStatus;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  checkCount: number;
  upCount: number;
  consecutiveDown: number;
  createdAt: string;
  updatedAt: string;
};

export type Heartbeat = {
  id: string;
  monitorId: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  certExpiryDays: number | null;
  checkedAt: string;
};

export type SaveMonitorRequest = {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string> | null;
  body?: string | null;
  bodyEncoding?: string;
  expectedStatusCodes?: number[];
  intervalSeconds?: number;
  timeoutSeconds?: number;
  retries?: number;
  retryIntervalSeconds?: number;
  monitorGroup?: string | null;
  certExpiryCheck?: boolean;
  upsideDownMode?: boolean;
  maxRedirects?: number;
  active?: boolean;
  tags?: string[];
  contactPointId?: string | null;
};

/** Uptime percentage over a window. */
export type UptimeWindow = {
  label: string;
  percentage: number;
};

/** Summary stats for the monitor list. */
export type MonitorSummary = Monitor & {
  uptime24h: number | null;
  uptime30d: number | null;
  avgResponseMs: number | null;
  certExpiryDays: number | null;
};

export const DEFAULT_MONITOR_INTERVAL = 60;
export const DEFAULT_MONITOR_TIMEOUT = 30;
export const DEFAULT_MONITOR_RETRIES = 3;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const BODY_ENCODINGS = ['json', 'text', 'form'] as const;
