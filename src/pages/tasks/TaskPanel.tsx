import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Archive, Link2, Send, X } from 'lucide-react';
import { addComment, ApiFailure, archiveTask, getTask, updateTask } from '../../app/api';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
import {
  EVENT_PHRASE,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_CATEGORY,
  STATUS_LABEL,
  STATUS_ORDER,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TimelineEntry,
} from '../../../shared/tasks';

/**
 * One task, opened beside the list.
 *
 * Comments and events share a single stream, so the whole story of the task
 * reads from top to bottom without changing tab.
 */

function when(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Turns a stored value into the words the timeline shows. */
function say(entry: Extract<TimelineEntry, { kind: 'event' }>): string {
  const phrase = EVENT_PHRASE[entry.event];
  if (entry.event === 'status' && entry.to) return `${phrase} ${STATUS_LABEL[entry.to as TaskStatus]}`;
  if (entry.event === 'priority' && entry.to) return `${phrase} ${PRIORITY_LABEL[entry.to as TaskPriority]}`;
  return phrase;
}

export default function TaskPanel({
  taskId,
  editable,
  onClose,
  onChanged,
}: {
  taskId: string;
  editable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const result = await getTask(taskId);
      setTask(result.task);
      setTimeline(result.timeline);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the task.');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the panel, which is what a person expects of an overlay.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function patch(change: Parameters<typeof updateTask>[1]) {
    if (!task) return;
    setError(null);
    try {
      await updateTask(task.id, change);
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!task || !draft.trim()) return;

    setBusy(true);
    try {
      await addComment(task.id, draft.trim());
      setDraft('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'The comment did not send.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!task) return;
    await navigator.clipboard.writeText(`${window.location.origin}/tasks?t=${task.ref}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button type="button" className="panel-scrim" aria-label="Close the task" onClick={onClose} />
      <aside className="task-panel" role="dialog" aria-label={task ? task.title : 'Task'}>
        {task === null ? (
          <div className="task-panel-body">
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-line" />
          </div>
        ) : (
          <>
            <header className="task-panel-head">
              <span className="task-ref">{task.ref}</span>
              <div className="task-panel-actions">
                <button type="button" className="ghost-button" onClick={copyLink}>
                  <Link2 size={14} aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                {editable && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={async () => {
                      const wasArchived = task.archived;
                      await archiveTask(task.id, !wasArchived);
                      await load();
                      onChanged();
                      // Archiving hides a task rather than destroying it, so
                      // the toast says so instead of a dialog asking first.
                      if (wasArchived) toast.done(`${task.ref} is back.`);
                      else toast.done(`${task.ref} is archived.`, 'Nothing is lost. Restore it from this panel.');
                    }}
                  >
                    <Archive size={14} aria-hidden="true" />
                    {task.archived ? 'Restore' : 'Archive'}
                  </button>
                )}
                <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="task-panel-body">
              <h2>{task.title}</h2>

              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}

              <div className="task-fields">
                <label className="field plain">
                  <span>Status</span>
                  <select
                    value={task.status}
                    disabled={!editable}
                    onChange={(event) => void patch({ status: event.target.value as TaskStatus })}
                  >
                    {STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field plain">
                  <span>Priority</span>
                  <select
                    value={task.priority}
                    disabled={!editable}
                    onChange={(event) => void patch({ priority: event.target.value as TaskPriority })}
                  >
                    {PRIORITY_ORDER.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABEL[priority]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field plain">
                  <span>Starts</span>
                  <input
                    type="date"
                    disabled={!editable}
                    value={task.startDate ? task.startDate.slice(0, 10) : ''}
                    onChange={(event) =>
                      void patch({
                        startDate: event.target.value ? new Date(event.target.value).toISOString() : null,
                      })
                    }
                  />
                </label>

                <label className="field plain">
                  <span>Due</span>
                  <input
                    type="date"
                    disabled={!editable}
                    value={task.dueDate ? task.dueDate.slice(0, 10) : ''}
                    onChange={(event) =>
                      void patch({
                        dueDate: event.target.value ? new Date(event.target.value).toISOString() : null,
                      })
                    }
                  />
                </label>
              </div>

              <label className="field plain">
                <span>Background</span>
                <textarea
                  rows={4}
                  disabled={!editable}
                  defaultValue={task.description ?? ''}
                  placeholder="What is this about?"
                  onBlur={(event) => {
                    if (event.target.value !== (task.description ?? '')) {
                      void patch({ description: event.target.value });
                    }
                  }}
                />
              </label>

              <h3 className="timeline-head">Activity</h3>
              <ol className="timeline">
                {timeline.map((entry) =>
                  entry.kind === 'comment' ? (
                    <li key={entry.id} className="timeline-comment">
                      <strong>{entry.author?.fullName ?? 'Somebody'}</strong>
                      <time>{when(entry.createdAt)}</time>
                      <p>{entry.body}</p>
                    </li>
                  ) : (
                    <li key={entry.id} className="timeline-event">
                      <span className={`cat-dot cat-${entry.to ? STATUS_CATEGORY[entry.to as TaskStatus] : 'active'}`} aria-hidden="true" />
                      <span>
                        <strong>{entry.actor?.fullName ?? 'Somebody'}</strong> {say(entry)}
                      </span>
                      <time>{when(entry.createdAt)}</time>
                    </li>
                  ),
                )}
              </ol>
            </div>

            {editable && (
              <form className="comment-box" onSubmit={post}>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a comment"
                  maxLength={20000}
                />
                <button type="submit" className="primary-button" disabled={busy || !draft.trim()}>
                  <Send size={14} aria-hidden="true" />
                  {busy ? 'Sending' : 'Send'}
                </button>
              </form>
            )}
          </>
        )}
      </aside>
    </>
  );
}
