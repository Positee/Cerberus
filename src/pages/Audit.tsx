import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, Download, FileText, TriangleAlert } from 'lucide-react';
import { ApiFailure, listAudit, listAuditActors, auditExportUrl } from '../app/api';
import type { Session } from '../app/session';
import { useToast } from '../app/toast';
import { LIMITS, PLAN_LABEL } from '../../shared/plans';
import {
  ACTION_LABEL,
  CATEGORY_LABEL,
  describeFilter,
  EXPORT_CAP,
  PAGE_SIZE,
  type AuditCategory,
  type AuditEvent,
  type AuditFilter,
  type AuditResult,
} from '../../shared/audit';

/**
 * The audit trail.
 *
 * Every filter narrows the table, and the export sits under the filters rather
 * than beside them. A person filters first, reads what they have, then takes
 * exactly that away. An export button above the filters would suggest it
 * downloads everything.
 */

const RESULTS: Array<{ id: AuditResult | 'all'; label: string }> = [
  { id: 'all', label: 'All events' },
  { id: 'allowed', label: 'Allowed' },
  { id: 'denied', label: 'Denied' },
];

const CATEGORIES = Object.keys(CATEGORY_LABEL) as AuditCategory[];

function when(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export default function Audit({ session }: { session: Session }) {
  const toast = useToast();

  const [result, setResult] = useState<AuditResult | 'all'>('all');
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actors, setActors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // One filter object feeds the table and both exports, so a downloaded report
  // always holds exactly the rows on screen.
  const filter = useMemo<AuditFilter>(
    () => ({
      ...(result !== 'all' ? { result } : {}),
      ...(category ? { category } : {}),
      ...(actor ? { actor } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [result, category, actor, from, to],
  );

  /*
     A ticket per request.

     Each round trip to the database costs real time, so changing a filter
     twice quickly leaves two requests in flight. Without a ticket the slower
     one lands last and the table shows the wrong rows.
  */
  const ticket = useRef(0);

  const load = useCallback(async (which: number) => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const result = await listAudit(filter, which);
      if (mine !== ticket.current) return;
      setEvents(result.events);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      if (mine !== ticket.current) return;
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the audit log.');
      setEvents([]);
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [filter]);

  // A new filter always starts at the first page. Staying on page 4 of a
  // narrower filter would show an empty table that looks like a fault.
  useEffect(() => {
    setPage(0);
  }, [filter]);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  useEffect(() => {
    listAuditActors()
      .then((result) => setActors(result.actors))
      .catch(() => {
        // The picker falls back to a free text box, so this needs no notice.
      });
  }, []);

  const history = LIMITS[session.organization.plan].historyDays;
  const shown = events?.length ?? 0;
  const empty = events !== null && shown === 0;

  function download(format: 'csv' | 'pdf') {
    if (empty) return;
    // A plain link, so the browser handles the save and the cookie rides along.
    window.location.href = auditExportUrl(filter, format);
    toast.done(`The ${format.toUpperCase()} is on its way.`, describeFilter(filter));
  }

  return (
    <div className="page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="panel audit-filters">
        <div className="filter-row">
          <div className="segmented" role="group" aria-label="Result">
            {RESULTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={result === option.id ? 'active' : ''}
                aria-pressed={result === option.id}
                onClick={() => setResult(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="audit-fields">
          <label className="field plain">
            <span>Area</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as AuditCategory | '')}>
              <option value="">Everything</option>
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABEL[option]}
                </option>
              ))}
            </select>
          </label>

          <label className="field plain">
            <span>Actor</span>
            <input
              list="audit-actors"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Anybody"
            />
            <datalist id="audit-actors">
              {actors.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>

          <label className="field plain">
            <span>From</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>

          <label className="field plain">
            <span>To</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>

        {/* The export belongs under the filters. It takes away what the filters
            left behind, so it reads as the last step rather than a separate one. */}
        <div className="audit-export">
          <p>
            <strong>{total}</strong> {total === 1 ? 'event' : 'events'} match {describeFilter(filter)}.
            {shown < total && ` Showing the newest ${shown}.`}
            {total > EXPORT_CAP
              ? ` An export carries the newest ${EXPORT_CAP.toLocaleString()}. Narrow the filter to take the rest.`
              : shown < total
                ? ` An export carries all ${total}.`
                : ''}
          </p>
          <div className="audit-export-actions">
            <button type="button" className="ghost-button" disabled={empty} onClick={() => download('csv')}>
              <Download size={14} aria-hidden="true" />
              Export this as CSV
            </button>
            <button type="button" className="ghost-button" disabled={empty} onClick={() => download('pdf')}>
              <FileText size={14} aria-hidden="true" />
              Export this as PDF
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Audit log</h3>
          <p>
            Every action anybody takes, allowed or denied.{' '}
            {history === null
              ? 'Your plan keeps it for good.'
              : `The ${PLAN_LABEL[session.organization.plan]} plan keeps ${history} days.`}
          </p>
        </div>

        {events === null ? (
          <>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </>
        ) : empty ? (
          <p className="field-hint">No events match this filter.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Source IP</th>
                  <th scope="col">When</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.actor}</th>
                    <td>
                      <span className="audit-action">{ACTION_LABEL[row.action] ?? row.action}</span>
                      <code>{row.action}</code>
                    </td>
                    <td>{row.resource}</td>
                    <td className="muted">{row.ip ?? '—'}</td>
                    <td className="muted">{when(row.at)}</td>
                    <td>
                      {/* Icon plus word. The colour is support, not the message. */}
                      <span
                        className={row.result === 'allowed' ? 'state-tag state-healthy' : 'state-tag state-offline'}
                      >
                        {row.result === 'allowed' ? (
                          <CircleCheck size={13} aria-hidden="true" />
                        ) : (
                          <CircleX size={13} aria-hidden="true" />
                        )}
                        {row.result === 'allowed' ? 'Allowed' : 'Denied'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The pager. Without it everything past the first 200 rows was
            unreachable, however far back the plan allowed. */}
        {total > PAGE_SIZE && (
          <div className="audit-pager">
            <button
              type="button"
              className="ghost-button"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Newer
            </button>
            <span>
              {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button
              type="button"
              className="ghost-button"
              disabled={(page + 1) * PAGE_SIZE >= total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Older
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
