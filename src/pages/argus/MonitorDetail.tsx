import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Clock, ExternalLink, RotateCcw } from 'lucide-react';
import { listHeartbeats, resetMonitor } from '../../app/api';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
import type { MonitorSummary, Heartbeat } from '../../../shared/argus';

type Props = {
  monitor: MonitorSummary;
  editable: boolean;
  onUpdated: (m: MonitorSummary) => void;
  onDeleted: () => void;
  onBack: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  up: 'var(--state-healthy)',
  down: 'var(--state-offline)',
  degraded: 'var(--state-degraded)',
  pending: 'var(--faint)',
};

const STATUS_LABELS: Record<string, string> = {
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
  pending: 'Pending',
};

function formatMs(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeAgo(date: string | null): string {
  if (!date) return 'never';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MonitorDetail({ monitor, editable, onUpdated, onBack }: Props) {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const confirm = useConfirm();

  const loadHeartbeats = useCallback(async () => {
    try {
      const res = await listHeartbeats(monitor.id, { limit: 100 });
      setHeartbeats(res.heartbeats);
    } catch {
      // Heartbeats failed to load.
    } finally {
      setLoading(false);
    }
  }, [monitor.id]);

  useEffect(() => {
    loadHeartbeats();
  }, [loadHeartbeats]);

  // Build status bars from heartbeats (most recent 20).
  const bars = heartbeats.slice(0, 20).reverse();

  const handleReset = () => {
    confirm.ask({
      title: `Reset ${monitor.name}?`,
      body: 'This sets the check count, up count, and consecutive down count back to zero.',
      action: 'Reset stats',
      destructive: false,
      onConfirm: async () => {
        try {
          const updated = await resetMonitor(monitor.id);
          onUpdated({ ...updated, uptime24h: null, uptime30d: null, avgResponseMs: null, certExpiryDays: null });
          toast.done('Monitor stats reset to zero.');
        } catch {
          toast.fail('Could not reset the monitor.');
        }
      },
    });
  };

  return (
    <div className="argus-detail-content">
      <div className="argus-detail-head">
        <button className="ghost-button" onClick={onBack} style={{ marginRight: 8 }}>
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <div style={{ flex: 1 }}>
          <h3>{monitor.name}</h3>
          <p style={{ color: 'var(--faint)', fontSize: 'var(--fs-label)', margin: '2px 0 0' }}>
            {monitor.url}
          </p>
        </div>
        {editable && (
          <button className="argus-reset-btn" onClick={handleReset} title="Reset check count and uptime stats">
            <RotateCcw size={13} aria-hidden="true" />
            Reset
          </button>
        )}
        <a
          className="ghost-button"
          href={monitor.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Open
        </a>
      </div>

      {/* Status bars */}
      <div className="argus-status-bars">
        {bars.map((hb) => (
          <span
            key={hb.id}
            className="argus-bar"
            style={{ background: STATUS_COLORS[hb.status] }}
            title={`${STATUS_LABELS[hb.status]} at ${formatTime(hb.checkedAt)} - ${formatMs(hb.responseTimeMs)}`}
          />
        ))}
        {bars.length === 0 && (
          <span className="field-hint">No heartbeat data yet. The first probe will arrive soon.</span>
        )}
      </div>

      {/* KPI row */}
      <div className="kpi-row">
        <div className="kpi">
          <p className="kpi-label">Status</p>
          <p className="kpi-value" style={{ color: STATUS_COLORS[monitor.currentStatus], fontSize: '1.25rem' }}>
            {STATUS_LABELS[monitor.currentStatus]}
          </p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Uptime (24h)</p>
          <p className="kpi-value">{monitor.uptime24h !== null ? `${monitor.uptime24h}%` : '--'}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Uptime (30d)</p>
          <p className="kpi-value">{monitor.uptime30d !== null ? `${monitor.uptime30d}%` : '--'}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Avg Response</p>
          <p className="kpi-value">{formatMs(monitor.avgResponseMs)}</p>
        </div>
        {monitor.certExpiryDays !== null && (
          <div className="kpi">
            <p className="kpi-label">Cert Expiry</p>
            <p className="kpi-value" style={{ color: monitor.certExpiryDays < 30 ? 'var(--warn)' : undefined }}>
              {monitor.certExpiryDays}d
            </p>
          </div>
        )}
      </div>

      {/* Config summary */}
      <div className="panel">
        <div className="panel-head">
          <h3>Configuration</h3>
        </div>
        <div className="argus-config-grid">
          <div className="argus-config-item">
            <span className="argus-config-label">Method</span>
            <span className="argus-config-value">{monitor.method}</span>
          </div>
          <div className="argus-config-item">
            <span className="argus-config-label">Interval</span>
            <span className="argus-config-value">{monitor.intervalSeconds}s</span>
          </div>
          <div className="argus-config-item">
            <span className="argus-config-label">Timeout</span>
            <span className="argus-config-value">{monitor.timeoutSeconds}s</span>
          </div>
          <div className="argus-config-item">
            <span className="argus-config-label">Retries</span>
            <span className="argus-config-value">{monitor.retries}</span>
          </div>
          <div className="argus-config-item">
            <span className="argus-config-label">Checks</span>
            <span className="argus-config-value">{monitor.checkCount}</span>
          </div>
          <div className="argus-config-item">
            <span className="argus-config-label">Last checked</span>
            <span className="argus-config-value">{timeAgo(monitor.lastCheckedAt)}</span>
          </div>
        </div>
      </div>

      {/* Heartbeat log */}
      <div className="panel">
        <div className="panel-head">
          <h3>Recent heartbeats</h3>
          <p>Latest {Math.min(heartbeats.length, 50)} probe results.</p>
        </div>

        {loading ? (
          <div className="argus-loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="argus-monitor-row skeleton-line" />
            ))}
          </div>
        ) : heartbeats.length === 0 ? (
          <div className="empty-note">
            <p>No heartbeats yet. The first probe will arrive soon.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Time</th>
                <th>Response</th>
                <th>Status code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.slice(0, 50).map((hb) => (
                <tr key={hb.id}>
                  <td>
                    <span
                      className="argus-status-dot"
                      style={{ background: STATUS_COLORS[hb.status], display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}
                    />
                    <span className={`state-tag state-${hb.status === 'up' ? 'healthy' : hb.status === 'down' ? 'offline' : 'degraded'}`}>
                      {STATUS_LABELS[hb.status]}
                    </span>
                  </td>
                  <td>{formatTime(hb.checkedAt)}</td>
                  <td className="num">{formatMs(hb.responseTimeMs)}</td>
                  <td className="num">{hb.statusCode ?? '--'}</td>
                  <td className="muted">{hb.errorMessage ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
