import { FormEvent, useEffect, useState } from 'react';
import { Save, X, Plus } from 'lucide-react';
import { createMonitor, updateMonitor, listContactPoints } from '../../app/api';
import { useToast } from '../../app/toast';
import { allows, type Session } from '../../app/session';
import type { ContactPoint } from '../../../shared/alerting';
import type { Monitor, MonitorSummary, SaveMonitorRequest } from '../../../shared/argus';
import { HTTP_METHODS, DEFAULT_MONITOR_INTERVAL, DEFAULT_MONITOR_TIMEOUT, DEFAULT_MONITOR_RETRIES } from '../../../shared/argus';

type Props = {
  session: Session;
  onCreated: (m: MonitorSummary) => void;
  onCancel: () => void;
  /** Pre-fill the form for editing. */
  initial?: Partial<SaveMonitorRequest> & { id?: string };
};

const MONITOR_TYPES: { value: string; label: string; disabled?: boolean }[] = [
  { value: 'http', label: 'HTTP/HTTPS' },
  { value: 'ping', label: 'Ping (ICMP)', disabled: true },
  { value: 'tcp', label: 'TCP Port', disabled: true },
];

const DEFAULT_STATUS_CODES = [200, 201, 202, 203, 204, 205, 206, 207, 208, 226];

const formatStatusSummary = (codes: number[]) => {
  if (codes.length === 0) return 'No accepted codes';

  const sorted = [...codes].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const isContiguous = sorted.every((code, index) => index === 0 || code === sorted[index - 1] + 1);
  const matchesDefault = sorted.length === DEFAULT_STATUS_CODES.length
    && sorted.every((code, index) => code === DEFAULT_STATUS_CODES[index]);

  if (matchesDefault) return 'Common 2xx responses';
  if (sorted.length === 1) return `${first}`;
  if (isContiguous) return `${first}-${last}`;
  return `${sorted.length} accepted codes`;
};

export default function MonitorForm({ session, onCreated, onCancel, initial }: Props) {
  const toast = useToast();
  const editable = allows(session, 'alert.manage');
  const isEdit = !!initial?.id;

  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [method, setMethod] = useState(initial?.method ?? 'GET');
  const [interval, setInterval] = useState(initial?.intervalSeconds ?? DEFAULT_MONITOR_INTERVAL);
  const [timeout, setTimeout] = useState(initial?.timeoutSeconds ?? DEFAULT_MONITOR_TIMEOUT);
  const [retries, setRetries] = useState(initial?.retries ?? DEFAULT_MONITOR_RETRIES);
  const [retryInterval, setRetryInterval] = useState(initial?.retryIntervalSeconds ?? 60);
  const [group, setGroup] = useState(initial?.monitorGroup ?? '');
  const [contactPointId, setContactPointId] = useState(initial?.contactPointId ?? '');
  const [certCheck, setCertCheck] = useState(initial?.certExpiryCheck ?? true);
  const [maxRedirects, setMaxRedirects] = useState(initial?.maxRedirects ?? 10);
  const [monitorType, setMonitorType] = useState('http');

  const [contactPoints, setContactPoints] = useState<ContactPoint[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Status codes
  const [statusCodes, setStatusCodes] = useState<number[]>(
    initial?.expectedStatusCodes ?? [...DEFAULT_STATUS_CODES]
  );
  const [newCode, setNewCode] = useState('');

  useEffect(() => {
    listContactPoints().then((res) => setContactPoints(res.contactPoints)).catch(() => {});
  }, []);

  const addStatusCode = () => {
    const code = parseInt(newCode, 10);
    if (isNaN(code) || code < 100 || code > 599) return;
    if (statusCodes.includes(code)) return;
    setStatusCodes([...statusCodes, code].sort((a, b) => a - b));
    setNewCode('');
  };

  const removeStatusCode = (code: number) => {
    setStatusCodes(statusCodes.filter((c) => c !== code));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name the monitor.';
    if (!url.trim()) errs.url = 'Enter a URL.';
    else {
      try { new URL(url); } catch { errs.url = 'Enter a valid URL.'; }
    }
    if (statusCodes.length === 0) errs.statusCodes = 'Add at least one status code.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const body: SaveMonitorRequest = {
        name: name.trim(),
        url: url.trim(),
        method,
        intervalSeconds: interval,
        timeoutSeconds: timeout,
        retries,
        retryIntervalSeconds: retryInterval,
        monitorGroup: group.trim() || null,
        contactPointId: contactPointId || null,
        certExpiryCheck: certCheck,
        maxRedirects,
        expectedStatusCodes: statusCodes,
        active: true,
      };

      if (isEdit && initial?.id) {
        const updated = await updateMonitor(initial.id, body);
        onCreated({ ...updated, uptime24h: null, uptime30d: null, avgResponseMs: null, certExpiryDays: null });
      } else {
        const created = await createMonitor(body);
        onCreated({ ...created, uptime24h: null, uptime30d: null, avgResponseMs: null, certExpiryDays: null });
      }
    } catch {
      toast.fail(isEdit ? 'The monitor was not updated.' : 'The monitor was not created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="argus-form" onSubmit={handleSubmit}>
      <div className="argus-form-scroll">
        <div className="argus-form-head">
          <h3>{isEdit ? 'Edit Monitor' : 'Add Monitor'}</h3>
          <p>Watch an endpoint and alert when it goes down.</p>
        </div>

        <div className="argus-form-grid">
          <section className="argus-form-section">
            <h4>General</h4>

            <label className="argus-control">
              <span>Monitor Type</span>
              <select value={monitorType} onChange={(e) => setMonitorType(e.target.value)}>
                {MONITOR_TYPES.map((t) => (
                  <option key={t.value} value={t.value} disabled={t.disabled}>
                    {t.label}{t.disabled ? ' (coming soon)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="argus-control">
              <span>Friendly Name</span>
              <input
                placeholder="Credit Bureau CRC"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <p className="field-hint argus-error">{errors.name}</p>}
            </label>

            <label className="argus-control">
              <span>URL</span>
              <input
                placeholder="https://example.com/api/health"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {errors.url && <p className="field-hint argus-error">{errors.url}</p>}
            </label>

            <div className="argus-control-grid argus-control-grid-3">
              <label className="argus-control">
                <span>Method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="argus-control">
                <span>Heartbeat Interval</span>
                <input
                  type="number"
                  min={10}
                  max={86400}
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
              </label>
              <label className="argus-control">
                <span>Request Timeout</span>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={timeout}
                  onChange={(e) => setTimeout(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="argus-control-grid argus-control-grid-3">
              <label className="argus-control">
                <span>Retries</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={retries}
                  onChange={(e) => setRetries(Number(e.target.value))}
                />
              </label>
              <label className="argus-control">
                <span>Retry Interval</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={retryInterval}
                  onChange={(e) => setRetryInterval(Number(e.target.value))}
                />
              </label>
              <label className="argus-control">
                <span>Max Redirects</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={maxRedirects}
                  onChange={(e) => setMaxRedirects(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="argus-control argus-status-control">
              <span>Accepted Status Codes</span>
              <div className="argus-status-select">
                <span className="argus-status-summary-chip">{formatStatusSummary(statusCodes)}</span>
                <span className="argus-status-count">{statusCodes.length} codes</span>
                <span className="argus-status-add">
                  <input
                    type="number"
                    min={100}
                    max={599}
                    placeholder="Add code"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStatusCode(); } }}
                  />
                  <button type="button" onClick={addStatusCode} aria-label="Add status code">
                    <Plus size={14} />
                  </button>
                </span>
              </div>
              <p className="field-hint">
                Responses outside this accepted set mark the monitor as down.
              </p>
              {errors.statusCodes && <p className="field-hint argus-error">{errors.statusCodes}</p>}

              <details className="argus-status-details">
                <summary>Review individual codes</summary>
                <div className="argus-status-codes">
                  {statusCodes.map((code) => (
                    <span key={code} className="argus-status-code-chip">
                      {code}
                      <button type="button" onClick={() => removeStatusCode(code)} aria-label={`Remove ${code}`}>x</button>
                    </span>
                  ))}
                </div>
              </details>
            </div>
          </section>

          <section className="argus-form-section argus-form-side">
            <h4>Notifications</h4>

            <label className="argus-control">
              <span>Contact Point</span>
              <select
                value={contactPointId}
                onChange={(e) => setContactPointId(e.target.value)}
              >
                <option value="">None</option>
                {contactPoints.map((cp) => (
                  <option key={cp.id} value={cp.id}>{cp.name}</option>
                ))}
              </select>
            </label>

            <h4>Advanced</h4>

            <label className="argus-control">
              <span>Monitor Group</span>
              <input
                placeholder="Credit bureaus"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </label>

            <ul className="switch-list argus-switch-list">
              <li>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={certCheck}
                    onChange={(e) => setCertCheck(e.target.checked)}
                  />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                  <span className="switch-text">
                    <strong>Certificate expiry check</strong>
                    <small>Alert when the TLS cert expires within 30 days.</small>
                  </span>
                </label>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <div className="argus-form-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={saving || !editable}
        >
          <Save size={14} aria-hidden="true" />
          {saving ? 'Saving...' : isEdit ? 'Update' : 'Save'}
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          <X size={14} aria-hidden="true" />
          Cancel
        </button>
      </div>
    </form>
  );
}
