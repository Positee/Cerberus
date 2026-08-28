import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CirclePlay, Pause, Pencil, Play, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  ApiFailure,
  createSchedule,
  deleteSchedule,
  listContactPoints,
  listSchedules,
  runScheduleNow,
  updateSchedule,
  workspaceMembers,
} from '../app/api';
import { allows, type Session } from '../app/session';
import { useToast } from '../app/toast';
import { useConfirm } from '../app/confirm';
import type { WorkspaceMember } from '../../shared/api';
import type { ContactPoint } from '../../shared/alerting';
import {
  CADENCE_LABEL,
  DEFAULT_RECURRENCE,
  DORMANT_REASON,
  FILTER_LABEL,
  KIND_BLURB,
  KIND_LABEL,
  WEEKDAY_SHORT,
  describe,
  matchesFilter,
  nextRun,
  type Cadence,
  type Recurrence,
  type ReminderPayload,
  type Schedule,
  type ScheduleFilter,
  type ScheduleKind,
  type TaskPayload,
} from '../../shared/schedules';
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
} from '../../shared/tasks';

/**
 * Scheduled.
 *
 * A schedule is a standing instruction. The form works out the next run as a
 * person edits, using the same rule the runner uses, so what the screen
 * promises is what happens.
 */

const KINDS: ScheduleKind[] = ['reminder', 'task', 'report', 'scan'];
const FILTERS: ScheduleFilter[] = ['all', 'active', 'paused', 'never'];

function when(value: string | null): string {
  if (!value) return 'Paused';
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** How far off, in words. Precision drops as the distance grows. */
function distance(value: string | null): string {
  if (!value) return '';
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return 'due now';

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export default function Scheduled({ session }: { session: Session }) {
  const editable = allows(session, 'task.manage');
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<Schedule[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [points, setPoints] = useState<ContactPoint[]>([]);
  const [contactPointId, setContactPointId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  /** The schedule being changed, or null when this is a new one. */
  const [editing, setEditing] = useState<Schedule | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('task');
  const [rec, setRec] = useState<Recurrence>({ ...DEFAULT_RECURRENCE });
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>('backlogs');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<ScheduleFilter>('all');

  const load = useCallback(async () => {
    try {
      const result = await listSchedules();
      setRows(result.schedules);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the schedules.');
      setRows([]);
    }
  }, []);

  // The c shortcut. The shell raises this, and the page decides what it makes.
  useEffect(() => {
    const onCreate = () => setComposing(true);
    window.addEventListener('cerberus:create', onCreate);
    return () => window.removeEventListener('cerberus:create', onCreate);
  }, []);

  useEffect(() => {
    void load();
    workspaceMembers()
      .then((result) => setMembers(result.members))
      .catch(() => setMembers([]));
    listContactPoints()
      .then((result) => setPoints(result.contactPoints))
      .catch(() => setPoints([]));
  }, [load]);

  function patchRec(change: Partial<Recurrence>) {
    setRec((prev) => ({ ...prev, ...change }));
  }

  function toggleDay(day: number) {
    setRec((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter((value) => value !== day)
        : [...prev.weekdays, day].sort(),
    }));
  }

  function reset() {
    setName('');
    setKind('task');
    setRec({ ...DEFAULT_RECURRENCE });
    setTitle('');
    setStatus('backlogs');
    setPriority('normal');
    setAssigneeId('');
    setNote('');
    setContactPointId('');
    setEditing(null);
    setComposing(false);
  }

  /** Opens the form on an existing schedule, seeded from what it holds. */
  function edit(row: Schedule) {
    setEditing(row);
    setName(row.name);
    setKind(row.kind);
    setRec({ ...DEFAULT_RECURRENCE, ...row.recurrence });

    const payload = row.payload as Partial<TaskPayload & ReminderPayload>;
    setTitle(payload.title ?? '');
    setStatus(payload.status ?? 'backlogs');
    setPriority(payload.priority ?? 'normal');
    setAssigneeId(payload.assigneeId ?? '');
    setNote(payload.note ?? '');
    setContactPointId(row.contactPointId ?? '');

    setComposing(true);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload =
      kind === 'reminder'
        ? { note: note.trim() }
        : kind === 'task'
          ? { title: title.trim(), status, priority, assigneeId: assigneeId || null }
          : kind === 'report'
            ? { period: 'month' as const }
            : { source: 'Trivy', scope: 'All assets' };

    try {
      if (editing) {
        // enabled is left out, so saving an edit never resumes a paused one.
        await updateSchedule(editing.id, {
          name: name.trim(),
          kind,
          recurrence: rec,
          payload,
          contactPointId: contactPointId || null,
        });
        toast.done(`${name.trim()} is saved.`, describe(rec));
      } else {
        await createSchedule({
          name: name.trim(),
          kind,
          enabled: true,
          recurrence: rec,
          payload,
          contactPointId: contactPointId || null,
        });
        toast.done('The schedule is on.', describe(rec));
      }
      reset();
      await load();
    } catch (caught) {
      const why = caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.';
      toast.fail(why);
      setError(why);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, work: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await work();
      toast.done(message);
      await load();
    } catch (caught) {
      const why = caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.';
      toast.fail(why);
      setError(why);
    }
  }

  // The same rule the runner uses, so the preview cannot drift from reality.
  const preview = nextRun(rec, new Date());

  /*
     What "filled in" means depends on the kind and on the cadence, so the
     check is explicit rather than a count of non-empty boxes. A weekly rule
     with no day chosen would otherwise save and never fire.
  */
  const missing: string[] = [];
  if (!name.trim()) missing.push('a name');
  if (kind === 'reminder' && !note.trim()) missing.push('what to say');
  if (kind === 'task' && !title.trim()) missing.push('a task title');
  if (rec.cadence === 'weekly' && rec.weekdays.length === 0) missing.push('at least one day');
  if (rec.cadence !== 'weekly' && (!rec.interval || rec.interval < 1)) missing.push('how often');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rec.timeOfDay)) missing.push('a time');

  const ready = missing.length === 0;
  const shown = (rows ?? []).filter((row) => matchesFilter(row, filter));

  return (
    <div className="page profile-page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}
      {editable && !composing && (
        <button type="button" className="primary-button" onClick={() => setComposing(true)}>
          <Plus size={15} aria-hidden="true" />
          New schedule
        </button>
      )}

      {composing && (
        <form className="panel" onSubmit={save}>
          <div className="panel-head">
            <h3>{editing ? 'Edit schedule' : 'New schedule'}</h3>
            <p>
              {editing
                ? 'Changing the timing works out a fresh next run. The run history stays.'
                : 'Say what to do, and how often. Cerberus does the rest.'}
            </p>
          </div>

          <div className="stack-fields">
            <label className="field plain">
              <span>Name</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Weekly dependency review"
                maxLength={120}
              />
            </label>

            <fieldset className="kind-row">
              <legend className="field-legend">What it does</legend>
              {KINDS.map((option) => (
                <label key={option} className={kind === option ? 'kind-card on' : 'kind-card'}>
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === option}
                    onChange={() => setKind(option)}
                  />
                  <strong>{KIND_LABEL[option]}</strong>
                  <small>{KIND_BLURB[option]}</small>
                </label>
              ))}
            </fieldset>

            {DORMANT_REASON[kind] && (
              <p className="policy-note">
                <TriangleAlert size={15} aria-hidden="true" />
                {DORMANT_REASON[kind]}
              </p>
            )}

            {kind === 'reminder' && (
              <label className="field plain">
                <span>What to say</span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Triage the inbox, then set up this week's meetings"
                  maxLength={200}
                />
                <small className="field-hint">This is the whole reminder. It tracks nothing.</small>
              </label>
            )}

            {kind === 'task' && (
              <>
                <label className="field plain">
                  <span>Task title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Review open critical findings"
                    maxLength={200}
                  />
                </label>

                <div className="split-fields">
                  <label className="field plain">
                    <span>Status</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
                      {STATUS_ORDER.map((value) => (
                        <option key={value} value={value}>
                          {STATUS_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field plain">
                    <span>Priority</span>
                    <select
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as TaskPriority)}
                    >
                      {PRIORITY_ORDER.map((value) => (
                        <option key={value} value={value}>
                          {PRIORITY_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field plain">
                    <span>Assignee</span>
                    <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                      <option value="">Nobody</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            <div className="split-fields">
              <label className="field plain">
                <span>How often</span>
                <select
                  value={rec.cadence}
                  onChange={(event) => patchRec({ cadence: event.target.value as Cadence })}
                >
                  {(Object.keys(CADENCE_LABEL) as Cadence[]).map((value) => (
                    <option key={value} value={value}>
                      {CADENCE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>

              {rec.cadence !== 'weekly' && (
                <label className="field plain">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    max={rec.cadence === 'daily' ? 365 : 12}
                    value={rec.interval}
                    onChange={(event) => patchRec({ interval: Number(event.target.value) || 1 })}
                  />
                  <small className="field-hint">{rec.cadence === 'daily' ? 'days' : 'months'}</small>
                </label>
              )}

              {rec.cadence === 'monthly' && (
                <label className="field plain">
                  <span>Day of month</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={rec.dayOfMonth}
                    onChange={(event) => patchRec({ dayOfMonth: Number(event.target.value) || 1 })}
                  />
                  <small className="field-hint">A short month uses its last day.</small>
                </label>
              )}

              <label className="field plain">
                <span>Time (UTC)</span>
                <input
                  type="time"
                  value={rec.timeOfDay}
                  onChange={(event) => patchRec({ timeOfDay: event.target.value })}
                />
              </label>
            </div>

            {rec.cadence === 'weekly' && (
              <div className="rule-clause">
                <span className="rule-word">On these days</span>
                <div className="chip-row">
                  {WEEKDAY_SHORT.map((label, day) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={rec.weekdays.includes(day)}
                      className={rec.weekdays.includes(day) ? 'chip on' : 'chip'}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="field plain">
              <span>Tell somebody</span>
              <select value={contactPointId} onChange={(event) => setContactPointId(event.target.value)}>
                <option value="">The bell only</option>
                {points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.name}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                {points.length === 0
                  ? 'Make a contact point under Alerting to send this to Slack, Google Chat, or email.'
                  : 'Every run lands in the bell. A contact point sends it out as well.'}
              </small>
            </label>

            <p className="preview-line">
              <strong>{describe(rec)}</strong>
              <span>
                First run {when(preview.toISOString())} ({distance(preview.toISOString())})
              </span>
            </p>

            <div className="form-actions between">
              <button type="button" className="ghost-button" onClick={reset}>
                Cancel
              </button>
              <span className="form-gate">
                {!ready && <small className="field-hint">Still needs {missing.join(', ')}.</small>}
                <button type="submit" className="primary-button" disabled={busy || !ready}>
                  {busy ? 'Saving' : editing ? 'Save changes' : 'Create schedule'}
                </button>
              </span>
            </div>
          </div>
        </form>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="filter-row" role="tablist" aria-label="Filter schedules">
          {FILTERS.map((value) => {
            const count = rows.filter((row) => matchesFilter(row, value)).length;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? 'filter-tab on' : 'filter-tab'}
                onClick={() => setFilter(value)}
              >
                {FILTER_LABEL[value]}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {rows === null ? (
        <section className="panel">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
        </section>
      ) : shown.length === 0 ? (
        <section className="empty-note">
          <h3>{rows.length === 0 ? 'Nothing scheduled' : `No ${FILTER_LABEL[filter].toLowerCase()} schedules`}</h3>
          <p>
            {rows.length === 0
              ? 'A schedule runs on its own and makes the work for you. Set one up and it keeps going.'
              : 'Every schedule is here, just not under this filter.'}
          </p>
        </section>
      ) : (
        <div className="schedule-list">
          {shown.map((row) => (
            <article
              className={`schedule${row.enabled ? '' : ' off'}${editing?.id === row.id ? ' editing' : ''}`}
              key={row.id}
            >
              <div className="schedule-main">
                <h3>
                  {row.name}
                  <span className="state-tag">{KIND_LABEL[row.kind]}</span>
                  {!row.enabled && <span className="state-tag">Paused</span>}
                </h3>
                <p>{describe(row.recurrence)}</p>
                <p className="schedule-times">
                  <span>
                    Next: <strong>{when(row.nextRunAt)}</strong>{' '}
                    {row.enabled && <em>{distance(row.nextRunAt)}</em>}
                  </span>
                  <span>
                    Ran {row.runCount} {row.runCount === 1 ? 'time' : 'times'}
                  </span>
                </p>

                {row.recentRuns.length > 0 && (
                  <ul className="run-list">
                    {row.recentRuns.slice(0, 3).map((run) => (
                      <li key={run.id}>
                        <span className={`run-dot run-${run.outcome}`} aria-hidden="true" />
                        <span className="run-outcome">{run.outcome}</span>
                        <time>{when(run.ranAt)}</time>
                        {run.createdTaskRef && <code>{run.createdTaskRef}</code>}
                        {run.note && <small>{run.note}</small>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {editable && (
                <div className="schedule-actions">
                  <button type="button" className="ghost-button" onClick={() => edit(row)}>
                    <Pencil size={14} aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void act(row.id, () => runScheduleNow(row.id), `${row.name} ran.`)}
                  >
                    <CirclePlay size={14} aria-hidden="true" />
                    Run now
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      void act(
                        row.id,
                        () => updateSchedule(row.id, { enabled: !row.enabled }),
                        row.enabled ? `${row.name} is paused.` : `${row.name} is on.`,
                      )
                    }
                  >
                    {row.enabled ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                    {row.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      confirm.ask({
                        title: `Delete ${row.name}?`,
                        body:
                          row.runCount > 0
                            ? `This schedule has run ${row.runCount} ${row.runCount === 1 ? 'time' : 'times'}. Deleting it removes the schedule and its run history. Anything it already created stays.`
                            : 'This removes the schedule for good. It will never run again.',
                        action: 'Delete schedule',
                        destructive: true,
                        onConfirm: () => act(row.id, () => deleteSchedule(row.id), `${row.name} is deleted.`),
                      })
                    }
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
