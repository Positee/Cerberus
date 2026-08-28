import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Archive, Download, FileText, Image as ImageIcon, Link2, Paperclip, Send, UploadCloud, X } from 'lucide-react';
import { addComment, ApiFailure, archiveTask, getTask, updateTask, uploadTaskAttachment } from '../../app/api';
import { useToast } from '../../app/toast';
import {
  EVENT_PHRASE,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_CATEGORY,
  STATUS_LABEL,
  STATUS_ORDER,
  TASK_ATTACHMENT_ACCEPT,
  TASK_ATTACHMENT_MAX_BYTES,
  type Task,
  type TaskAttachment,
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

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ file }: { file: TaskAttachment }) {
  if (file.mimeType.startsWith('image/')) return <ImageIcon size={15} aria-hidden="true" />;
  return <FileText size={15} aria-hidden="true" />;
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
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [draft, setDraft] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const result = await getTask(taskId);
      setTask(result.task);
      setTimeline(result.timeline);
      setAttachments(result.attachments ?? []);
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
    if (!task || (!draft.trim() && commentFiles.length === 0)) return;

    const oversized = commentFiles.find((file) => file.size > TASK_ATTACHMENT_MAX_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 10 MB.`);
      return;
    }

    setBusy(true);
    try {
      if (draft.trim()) {
        const entry = await addComment(task.id, draft.trim());
        if (entry.kind === 'comment') {
          await Promise.all(commentFiles.map((file) => uploadTaskAttachment(task.id, file, entry.id)));
        }
      } else {
        await Promise.all(commentFiles.map((file) => uploadTaskAttachment(task.id, file)));
      }
      setDraft('');
      setCommentFiles([]);
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

  async function uploadFiles(files: FileList | null) {
    if (!task || !files?.length) return;

    const list = Array.from(files);
    const oversized = list.find((file) => file.size > TASK_ATTACHMENT_MAX_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 10 MB.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await Promise.all(list.map((file) => uploadTaskAttachment(task.id, file)));
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'The file did not upload.');
    } finally {
      setBusy(false);
    }
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
              <div className="task-title-block">
                <span className={`status-tag st-${task.status}`}>{STATUS_LABEL[task.status]}</span>
                <h2>{task.title}</h2>
              </div>

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

              <section className="task-attachments">
                <div className="task-section-head">
                  <div>
                    <h3>Attachments</h3>
                    <p>{attachments.length} files on this task</p>
                  </div>
                  {editable && (
                    <label className="task-upload-button">
                      <UploadCloud size={15} aria-hidden="true" />
                      Upload
                      <input
                        type="file"
                        multiple
                        accept={TASK_ATTACHMENT_ACCEPT}
                        onChange={(event) => {
                          void uploadFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                {attachments.length > 0 ? (
                  <ul className="task-file-list task-file-list-panel">
                    {attachments.map((file) => (
                      <li key={file.id}>
                        <FileIcon file={file} />
                        <a href={`/api/tasks/${task.id}/attachments/${file.id}`} download={file.name}>
                          {file.name}
                        </a>
                        <small>{formatBytes(file.size)}</small>
                        <a
                          className="task-file-download"
                          href={`/api/tasks/${task.id}/attachments/${file.id}`}
                          download={file.name}
                          aria-label={`Download ${file.name}`}
                        >
                          <Download size={14} aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="task-empty-inline">No files attached yet.</p>
                )}
              </section>

              <h3 className="timeline-head">Activity</h3>
              <ol className="timeline">
                {timeline.map((entry) =>
                  entry.kind === 'comment' ? (
                    <li key={entry.id} className="timeline-comment">
                      <strong>{entry.author?.fullName ?? 'Somebody'}</strong>
                      <time>{when(entry.createdAt)}</time>
                      <p>{entry.body}</p>
                      {entry.attachments.length > 0 && (
                        <div className="timeline-files">
                          {entry.attachments.map((file) => (
                            <a key={file.id} href={`/api/tasks/${task.id}/attachments/${file.id}`} download={file.name}>
                              <FileIcon file={file} />
                              {file.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ) : (
                    <li key={entry.id} className="timeline-event">
                      <span className={`cat-dot${entry.to ? ` st-${entry.to}` : ' cat-active'}`} aria-hidden="true" />
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
                <div className="comment-input-wrap">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a comment"
                    maxLength={20000}
                  />
                  {commentFiles.length > 0 && (
                    <div className="comment-file-strip">
                      {commentFiles.map((file, index) => (
                        <span key={`${file.name}-${file.lastModified}-${index}`}>
                          <Paperclip size={12} aria-hidden="true" />
                          {file.name}
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setCommentFiles((current) => current.filter((_, i) => i !== index))}
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <label className="comment-attach-button" title="Attach files">
                  <Paperclip size={16} aria-hidden="true" />
                  <input
                    type="file"
                    multiple
                    accept={TASK_ATTACHMENT_ACCEPT}
                    onChange={(event) => {
                      if (event.target.files) setCommentFiles((current) => [...current, ...Array.from(event.target.files!)]);
                      event.target.value = '';
                    }}
                  />
                </label>
                <button type="submit" className="primary-button" disabled={busy || (!draft.trim() && commentFiles.length === 0)}>
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
