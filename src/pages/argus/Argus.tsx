import { useCallback, useEffect, useState } from 'react';
import { Activity, Edit3, Pause, Play, Plus, Search, Trash2 } from 'lucide-react';
import {
  listMonitors,
  deleteMonitor,
  pauseMonitor,
  resumeMonitor,
} from '../../app/api';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
import { allows, type Session } from '../../app/session';
import type { MonitorSummary } from '../../../shared/argus';
import MonitorForm from './MonitorForm';
import MonitorDetail from './MonitorDetail';

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

function uptimeColor(pct: number | null): string {
  if (pct === null) return 'var(--faint)';
  if (pct >= 99.5) return 'var(--state-healthy)';
  if (pct >= 95) return 'var(--state-degraded)';
  return 'var(--state-offline)';
}

function formatUptime(pct: number | null): string {
  if (pct === null) return '--';
  return pct.toFixed(pct === 100 ? 0 : pct >= 99 ? 1 : 2) + '%';
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

export default function Argus({ session }: { session: Session }) {
  const editable = allows(session, 'alert.manage');
  const toast = useToast();
  const confirm = useConfirm();

  const [monitors, setMonitors] = useState<MonitorSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down' | 'degraded'>('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<MonitorSummary | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    listMonitors()
      .then((res) => {
        if (alive) setMonitors(res.monitors);
      })
      .catch(() => {
        if (alive) setError('Cannot load monitors.');
      });
    return () => { alive = false; };
  }, [refreshKey]);

  useEffect(() => {
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const filtered = (monitors ?? []).filter((m) => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.url.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && m.currentStatus !== statusFilter) return false;
    return true;
  });

  const groups = new Map<string, MonitorSummary[]>();
  for (const m of filtered) {
    const group = m.monitorGroup ?? 'Ungrouped';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(m);
  }

  const selected = monitors?.find((m) => m.id === selectedId) ?? null;

  const handleDelete = async (id: string, name: string) => {
    confirm.ask({
      title: `Delete ${name}?`,
      body: 'This removes the monitor and all its heartbeat history.',
      action: 'Delete monitor',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteMonitor(id);
          toast.done(`Deleted ${name}.`);
          setMonitors((prev) => (prev ?? []).filter((m) => m.id !== id));
          if (selectedId === id) setSelectedId(null);
        } catch {
          toast.fail('The monitor was not deleted.');
        }
      },
    });
  };

  const handleEdit = (m: MonitorSummary) => {
    setEditing(m);
    setCreating(false);
    setSelectedId(m.id);
  };

  const handleToggle = async (m: MonitorSummary) => {
    try {
      const updated = m.active ? await pauseMonitor(m.id) : await resumeMonitor(m.id);
      toast.done(m.active ? `Paused ${m.name}.` : `Resumed ${m.name}.`);
      setMonitors((prev) =>
        (prev ?? []).map((row) =>
          row.id === m.id
            ? { ...row, active: updated.active, nextCheckAt: updated.nextCheckAt }
            : row,
        ),
      );
    } catch {
      toast.fail('Could not update the monitor.');
    }
  };

  const handleCreated = (m: MonitorSummary) => {
    setMonitors((prev) => [m, ...(prev ?? [])]);
    setCreating(false);
    setSelectedId(m.id);
    toast.done(`Monitor ${m.name} created.`);
  };

  const handleUpdated = (m: MonitorSummary) => {
    setMonitors((prev) => (prev ?? []).map((row) => (row.id === m.id ? { ...row, ...m } : row)));
    setEditing(null);
    toast.done(`Monitor ${m.name} updated.`);
  };

  const totalUp = (monitors ?? []).filter((m) => m.currentStatus === 'up').length;
  const totalDown = (monitors ?? []).filter((m) => m.currentStatus === 'down').length;
  const totalDegraded = (monitors ?? []).filter((m) => m.currentStatus === 'degraded').length;

  return (
    <div className="page argus-page">
      <div className="filter-row nowrap">
        <div className="topbar-search" style={{ flex: '0 1 280px', minWidth: 180 }}>
          <Search size={15} aria-hidden="true" />
          <input
            placeholder="Search monitors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="segmented">
          {(['all', 'up', 'down', 'degraded'] as const).map((s) => (
            <button
              key={s}
              className={statusFilter === s ? 'active' : ''}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {editable && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            Add Monitor
          </button>
        )}
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <p className="kpi-label">Total</p>
          <p className="kpi-value">{monitors?.length ?? '--'}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Up</p>
          <p className="kpi-value" style={{ color: 'var(--state-healthy)' }}>{totalUp}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Down</p>
          <p className="kpi-value" style={{ color: 'var(--state-offline)' }}>{totalDown}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Degraded</p>
          <p className="kpi-value" style={{ color: 'var(--state-degraded)' }}>{totalDegraded}</p>
        </div>
      </div>

      <div className="argus-layout">
        <div className="argus-sidebar">
          {error && <p className="field-hint">{error}</p>}

          {!monitors && !error && (
            <div className="argus-loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="argus-monitor-row skeleton-line" />
              ))}
            </div>
          )}

          {monitors && filtered.length === 0 && (
            <div className="empty-note">
              <h3>No monitors</h3>
              <p>
                {monitors.length === 0
                  ? 'Add a monitor to watch a service.'
                  : 'No monitors match your search.'}
              </p>
            </div>
          )}

          {Array.from(groups.entries()).map(([group, items]) => (
            <div key={group} className="argus-group">
              <div className="argus-group-head">
                <span className="argus-group-name">{group}</span>
                <span className="argus-group-count">{items.length}</span>
              </div>
              {items.map((m) => (
                <button
                  key={m.id}
                  className={`argus-monitor-row ${selectedId === m.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedId(m.id); setCreating(false); }}
                >
                  <span
                    className="argus-status-dot"
                    style={{ background: STATUS_COLORS[m.currentStatus] }}
                    aria-label={STATUS_LABELS[m.currentStatus]}
                  />
                  <span className="argus-monitor-name">{m.name}</span>
                  <span className="argus-uptime-pct" style={{ color: uptimeColor(m.uptime24h) }}>
                    {formatUptime(m.uptime24h)}
                  </span>
                  <span className="argus-bars" aria-hidden="true">
                    {Array.from({ length: 20 }, (_, i) => {
                      const colors = ['var(--state-healthy)', 'var(--state-healthy)', 'var(--state-offline)'];
                      const ci = i % 3 === 2 ? (m.uptime24h ?? 100) < 99 ? 2 : 0 : i % 3 === 0 ? 0 : 1;
                      return (
                        <i
                          key={i}
                          style={{
                            background: colors[ci],
                            opacity: 0.7 + (i / 20) * 0.3,
                          }}
                        />
                      );
                    })}
                  </span>
                  {editable && (
                    <span className="argus-row-actions">
                      <span
                        className="argus-row-action"
                        title="Edit"
                        onClick={(e) => { e.stopPropagation(); handleEdit(m); }}
                      >
                        <Edit3 size={13} />
                      </span>
                      <span
                        className="argus-row-action"
                        title={m.active ? 'Pause' : 'Resume'}
                        onClick={(e) => { e.stopPropagation(); handleToggle(m); }}
                      >
                        {m.active ? <Pause size={13} /> : <Play size={13} />}
                      </span>
                      <span
                        className="argus-row-action argus-row-action-danger"
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); handleDelete(m.id, m.name); }}
                      >
                        <Trash2 size={13} />
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="argus-detail">
          {creating || editing ? (
            <MonitorForm
              session={session}
              onCreated={editing ? handleUpdated : handleCreated}
              onCancel={() => { setCreating(false); setEditing(null); }}
              initial={editing ? {
                id: editing.id,
                name: editing.name,
                url: editing.url,
                method: editing.method,
                intervalSeconds: editing.intervalSeconds,
                timeoutSeconds: editing.timeoutSeconds,
                retries: editing.retries,
                retryIntervalSeconds: editing.retryIntervalSeconds,
                monitorGroup: editing.monitorGroup,
                contactPointId: editing.contactPointId,
                certExpiryCheck: editing.certExpiryCheck,
                maxRedirects: editing.maxRedirects,
                expectedStatusCodes: editing.expectedStatusCodes,
              } : undefined}
            />
          ) : selected ? (
            <MonitorDetail
              key={selected.id}
              monitor={selected}
              editable={editable}
              onUpdated={handleUpdated}
              onDeleted={() => { handleDelete(selected.id, selected.name); }}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="empty-note">
              <Activity size={32} style={{ color: 'var(--faint)', marginBottom: 8 }} />
              <h3>Select a monitor</h3>
              <p>Choose a monitor from the list to see its heartbeat history and stats.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
