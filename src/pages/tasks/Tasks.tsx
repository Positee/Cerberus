import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import { ApiFailure, listTasks, workspaceMembers } from '../../app/api';
import { allows, type Session } from '../../app/session';
import type { WorkspaceMember } from '../../../shared/api';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_CATEGORY,
  STATUS_LABEL,
  STATUS_ORDER,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../../shared/tasks';
import TaskPanel from './TaskPanel';
import TaskCompose from './TaskCompose';

/**
 * The work view.
 *
 * One list, always. Filters narrow it, and the list stays grouped by status
 * so a person always sees where each task stands.
 */

function shortDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** True when a due date has passed and the task is still open. */
function isLate(task: Task): boolean {
  if (!task.dueDate) return false;
  const category = STATUS_CATEGORY[task.status];
  if (category === 'done' || category === 'closed') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

export default function Tasks({ session }: { session: Session }) {
  const editable = allows(session, 'task.manage');

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [open, setOpen] = useState<Task | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  useEffect(() => {
    workspaceMembers()
      .then((result) => setMembers(result.members))
      .catch(() => setMembers([]));
  }, []);

  const load = useCallback(async () => {
    try {
      // The API does the filtering, so the list stays right however long it grows.
      const result = await listTasks({
        status: status || undefined,
        priority: priority || undefined,
        assigneeId: assigneeId || undefined,
      });
      setTasks(result.tasks);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the tasks.');
      setTasks([]);
    }
  }, [status, priority, assigneeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => (tasks ?? []).filter((task) => task.parentId === null), [tasks]);

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        key: category,
        label: CATEGORY_LABEL[category],
        rows: filtered.filter((task) => STATUS_CATEGORY[task.status] === category),
      })).filter((group) => group.rows.length > 0),
    [filtered],
  );

  const filtering = Boolean(status || priority || assigneeId);

  function clear() {
    setStatus('');
    setPriority('');
    setAssigneeId('');
  }

  return (
    <div className="page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="task-toolbar">
        {editable && (
          <button type="button" className="primary-button" onClick={() => setComposing(true)}>
            <Plus size={15} aria-hidden="true" />
            Create task
          </button>
        )}

        <label className="field plain inline">
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="field plain inline">
          <span className="sr-only">Filter by assignee</span>
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Anyone</option>
            <option value="none">Nobody</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="field plain inline">
          <span className="sr-only">Filter by priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_ORDER.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        {filtering && (
          <button type="button" className="ghost-button" onClick={clear}>
            <X size={14} aria-hidden="true" />
            Clear
          </button>
        )}

        <span className="toolbar-count">
          {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {tasks === null ? (
        <section className="panel">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </section>
      ) : filtered.length === 0 ? (
        <section className="empty-note">
          <h3>{filtering ? 'Nothing matches' : 'No tasks yet'}</h3>
          <p>
            {filtering
              ? 'Change the filters, or clear them to see everything.'
              : 'Create the first task, and it will show up here.'}
          </p>
          {filtering ? (
            <button type="button" className="primary-button" onClick={clear}>
              Clear the filters
            </button>
          ) : (
            editable && (
              <button type="button" className="primary-button" onClick={() => setComposing(true)}>
                <Plus size={15} aria-hidden="true" />
                Create task
              </button>
            )
          )}
        </section>
      ) : (
        <div className="task-groups">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="group-head">
                <span className={`cat-dot cat-${group.key}`} aria-hidden="true" />
                {group.label}
                <span>{group.rows.length}</span>
              </h3>
              <div className="task-list">
                {group.rows.map((task) => (
                  <button type="button" className="task-row" key={task.id} onClick={() => setOpen(task)}>
                    <span className={`prio-bar prio-${task.priority}`} aria-hidden="true" />
                    <span className="task-ref">{task.ref}</span>
                    <span className="task-title">{task.title}</span>
                    <span className={`status-tag cat-${STATUS_CATEGORY[task.status]}`}>
                      {STATUS_LABEL[task.status]}
                    </span>
                    <span className="task-meta">{PRIORITY_LABEL[task.priority]}</span>
                    <span className={isLate(task) ? 'task-meta late' : 'task-meta'}>{shortDate(task.dueDate)}</span>
                    <span className="task-meta">{task.assignee?.fullName ?? 'Nobody'}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {composing && <TaskCompose onClose={() => setComposing(false)} onCreated={() => void load()} />}

      {open && (
        <TaskPanel
          taskId={open.id}
          editable={editable}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
