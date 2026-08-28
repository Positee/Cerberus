import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CalendarDays,
  ChevronDown,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserCircle,
  X,
} from 'lucide-react';
import { ApiFailure, archiveTask, deleteTask, listTasks, workspaceMembers } from '../../app/api';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
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
  /** The archive folder, loaded only when somebody opens it. */
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archived, setArchived] = useState<Task[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  /** Reads the archive. Called when the folder opens and after each change. */
  const loadArchive = useCallback(async () => {
    try {
      const result = await listTasks({ archived: 'only' });
      setArchived(result.tasks);
    } catch {
      setArchived([]);
    }
  }, []);

  async function restore(task: Task) {
    try {
      await archiveTask(task.id, false);
      toast.done(`${task.ref} is back.`, 'It is in the list again.');
      await Promise.all([load(), loadArchive()]);
    } catch (caught) {
      toast.fail(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  function askDelete(task: Task) {
    confirm.ask({
      title: `Delete ${task.ref}?`,
      body: `${task.title} goes for good, with its comments and attachments. Nothing brings it back.`,
      action: 'Delete for good',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteTask(task.id);
          toast.done(`${task.ref} is deleted.`);
          await loadArchive();
        } catch (caught) {
          toast.fail(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
        }
      },
    });
  }

  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  // The c shortcut. The shell raises this, and the page decides what it makes.
  useEffect(() => {
    const onCreate = () => setComposing(true);
    window.addEventListener('cerberus:create', onCreate);
    return () => window.removeEventListener('cerberus:create', onCreate);
  }, []);

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
    <div className="page tasks-page">
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="task-toolbar">
        <div className="task-toolbar-main">
          {editable && (
            <button type="button" className="primary-button" onClick={() => setComposing(true)}>
              <Plus size={15} aria-hidden="true" />
              Create task
            </button>
          )}
          <span className="toolbar-count">
            {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        <div className="task-filter-bar">
          <label className="field plain inline">
            <span>Filter by status</span>
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
            <span>Filter by assignee</span>
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
            <span>Filter by priority</span>
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
        </div>
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
          <div className="task-list-head" aria-hidden="true">
            <span>Task</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Due</span>
            <span>Assignee</span>
            <span>Activity</span>
          </div>
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
                    <span className="task-name-cell">
                      <span className="task-ref">{task.ref}</span>
                      <span className="task-title">{task.title}</span>
                    </span>
                    <span className={`status-tag st-${task.status}`}>
                      {STATUS_LABEL[task.status]}
                    </span>
                    <span className="task-meta">{PRIORITY_LABEL[task.priority]}</span>
                    <span className={isLate(task) ? 'task-meta late task-date' : 'task-meta task-date'}>
                      <CalendarDays size={14} aria-hidden="true" />
                      {shortDate(task.dueDate) || 'No date'}
                    </span>
                    <span className="task-meta task-assignee">
                      <UserCircle size={14} aria-hidden="true" />
                      {task.assignee?.fullName ?? 'Nobody'}
                    </span>
                    <span className="task-signals">
                      <span title={`${task.commentCount} comments`}>
                        <MessageSquare size={14} aria-hidden="true" />
                        {task.commentCount}
                      </span>
                      <span title={`${task.attachmentCount} attachments`}>
                        <Paperclip size={14} aria-hidden="true" />
                        {task.attachmentCount}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* The archive sits at the bottom, shut. It holds what is out of the way,
          and deleting for good happens only from in here. */}
      <section className={archiveOpen ? 'task-archive open' : 'task-archive'}>
        <button
          type="button"
          className="task-archive-head"
          aria-expanded={archiveOpen}
          onClick={() => {
            const next = !archiveOpen;
            setArchiveOpen(next);
            if (next && archived === null) void loadArchive();
          }}
        >
          <ChevronDown size={15} className="task-archive-caret" aria-hidden="true" />
          <Archive size={15} aria-hidden="true" />
          <span>Archive</span>
          {archived !== null && <span className="task-archive-count">{archived.length}</span>}
        </button>

        {archiveOpen && (
          <div className="task-archive-body">
            {archived === null ? (
              <span className="skeleton skeleton-line" />
            ) : archived.length === 0 ? (
              <p className="task-empty-inline">Nothing is archived. An archived task waits here until you restore it or delete it.</p>
            ) : (
              <ul className="task-archive-list">
                {archived.map((task) => (
                  <li key={task.id}>
                    <button type="button" className="task-archive-open" onClick={() => setOpen(task)}>
                      <span className="task-ref">{task.ref}</span>
                      <span className="task-archive-title">{task.title}</span>
                      <span className={`status-tag st-${task.status}`}>{STATUS_LABEL[task.status]}</span>
                    </button>
                    {editable && (
                      <span className="task-archive-actions">
                        <button type="button" className="ghost-button" onClick={() => void restore(task)}>
                          <RotateCcw size={14} aria-hidden="true" />
                          Restore
                        </button>
                        <button type="button" className="ghost-button danger" onClick={() => askDelete(task)}>
                          <Trash2 size={14} aria-hidden="true" />
                          Delete
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {composing && <TaskCompose onClose={() => setComposing(false)} onCreated={() => void load()} />}

      {open && (
        <TaskPanel
          taskId={open.id}
          editable={editable}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void load();
            if (archiveOpen) void loadArchive();
          }}
        />
      )}
    </div>
  );
}
