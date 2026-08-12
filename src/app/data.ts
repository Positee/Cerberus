/** Placeholder data. Replace each export when the API lands. */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const kpis = [
  { id: 'open', label: 'Open findings', value: '1,284', delta: -8.4, good: true, note: 'vs previous 30 days' },
  { id: 'critical', label: 'Critical open', value: '37', delta: 12.1, good: false, note: '9 breach the 7 day SLA' },
  { id: 'mttr', label: 'Median time to fix', value: '4.2 d', delta: -19.6, good: true, note: 'across all severities' },
  { id: 'assets', label: 'Assets monitored', value: '612', delta: 3.2, good: true, note: '48 repositories, 21 clusters' },
];

export const severityBreakdown: Array<{ id: Severity; count: number; slaBreached: number }> = [
  { id: 'critical', count: 37, slaBreached: 9 },
  { id: 'high', count: 198, slaBreached: 24 },
  { id: 'medium', count: 604, slaBreached: 11 },
  { id: 'low', count: 445, slaBreached: 0 },
];

/** 30 days of new and resolved findings. */
export const trend = (() => {
  const start = new Date('2026-07-12T00:00:00Z');
  const newSeries = [
    62, 58, 71, 49, 44, 39, 41, 68, 74, 66, 59, 52, 38, 35, 57,
    63, 70, 81, 74, 61, 48, 42, 55, 64, 58, 51, 46, 39, 44, 37,
  ];
  const resolvedSeries = [
    41, 47, 52, 55, 38, 31, 34, 49, 58, 63, 67, 61, 44, 40, 52,
    59, 66, 72, 78, 71, 55, 47, 61, 69, 74, 68, 62, 51, 58, 64,
  ];
  return newSeries.map((value, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { date, added: value, resolved: resolvedSeries[index] };
  });
})();

export const exposedAssets: Array<{
  name: string;
  kind: string;
  critical: number;
  high: number;
  owner: string;
  lastScan: string;
}> = [
  { name: 'lendsqr/core-ledger', kind: 'Repository', critical: 9, high: 31, owner: 'Payments', lastScan: '12 min ago' },
  { name: 'lendsqr/adjutor-api', kind: 'Repository', critical: 7, high: 24, owner: 'Platform', lastScan: '38 min ago' },
  { name: 'prod-eu-west-1', kind: 'Cluster', critical: 6, high: 19, owner: 'Infrastructure', lastScan: '1 h ago' },
  { name: 'lendsqr/kyc-service', kind: 'Repository', critical: 5, high: 22, owner: 'Identity', lastScan: '2 h ago' },
  { name: 'registry/base-images', kind: 'Container', critical: 4, high: 17, owner: 'Platform', lastScan: '3 h ago' },
  { name: 'lendsqr/webhooks', kind: 'Repository', critical: 3, high: 14, owner: 'Payments', lastScan: '4 h ago' },
];

export const scanners: Array<{ name: string; state: 'healthy' | 'degraded' | 'offline'; detail: string }> = [
  { name: 'Trivy', state: 'healthy', detail: 'Last run 12 min ago' },
  { name: 'Semgrep', state: 'healthy', detail: 'Last run 26 min ago' },
  { name: 'Wazuh', state: 'healthy', detail: 'Streaming' },
  { name: 'Falco', state: 'degraded', detail: '2 of 21 nodes silent' },
  { name: 'osquery', state: 'healthy', detail: 'Streaming' },
  { name: 'Prowler', state: 'offline', detail: 'Credentials expired' },
];

export const activity: Array<{ who: string; what: string; target: string; when: string }> = [
  { who: 'Ada O.', what: 'closed', target: 'CVE-2026-3311 in core-ledger', when: '9 min ago' },
  { who: 'Cerberus', what: 'raised', target: '3 critical findings in adjutor-api', when: '38 min ago' },
  { who: 'Femi A.', what: 'assigned', target: 'CVE-2026-2870 to Platform', when: '1 h ago' },
  { who: 'Cerberus', what: 'flagged', target: 'public S3 bucket in prod-eu-west-1', when: '2 h ago' },
  { who: 'Ngozi E.', what: 'accepted risk on', target: 'CVE-2025-9912 until 30 Sep', when: '4 h ago' },
];

export const auditLog: Array<{
  actor: string;
  action: string;
  resource: string;
  ip: string;
  at: string;
  result: 'allowed' | 'denied';
}> = [
  { actor: 'ada@lendsqr.com', action: 'policy.update', resource: 'SLA / critical', ip: '102.89.34.7', at: '10 Aug 2026, 14:22', result: 'allowed' },
  { actor: 'femi@lendsqr.com', action: 'finding.suppress', resource: 'CVE-2025-9912', ip: '102.89.34.19', at: '10 Aug 2026, 13:04', result: 'allowed' },
  { actor: 'svc-ci@lendsqr.com', action: 'token.create', resource: 'ci-scanner', ip: '35.178.20.4', at: '10 Aug 2026, 11:47', result: 'allowed' },
  { actor: 'unknown', action: 'auth.login', resource: 'console', ip: '45.155.205.233', at: '10 Aug 2026, 09:31', result: 'denied' },
  { actor: 'ngozi@lendsqr.com', action: 'integration.connect', resource: 'Prowler', ip: '102.89.31.88', at: '9 Aug 2026, 17:12', result: 'allowed' },
  { actor: 'ada@lendsqr.com', action: 'member.invite', resource: 'tunde@lendsqr.com', ip: '102.89.34.7', at: '9 Aug 2026, 15:55', result: 'allowed' },
];

export const reports: Array<{ name: string; scope: string; cadence: string; format: string; next: string }> = [
  { name: 'Executive posture summary', scope: 'All assets', cadence: 'Monthly', format: 'PDF', next: '1 Sep 2026' },
  { name: 'SOC 2 evidence pack', scope: 'Production', cadence: 'Quarterly', format: 'ZIP', next: '30 Sep 2026' },
  { name: 'Critical SLA breaches', scope: 'Critical only', cadence: 'Weekly', format: 'CSV', next: '17 Aug 2026' },
  { name: 'Dependency drift', scope: 'Repositories', cadence: 'Weekly', format: 'CSV', next: '17 Aug 2026' },
];
