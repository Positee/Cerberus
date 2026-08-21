import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ApiFailure, createTask, workspaceMembers } from '../../app/api';
import type { WorkspaceMember } from '../../../shared/api';
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_CATEGORY,
  STATUS_LABEL,
  STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
} from '../../../shared/tasks';

/**
 * The create form.
 *
 * Everything a task carries, on one screen. A person fills the title and
 * saves, or fills the rest first. Only the title is required, so capture stays
 * fast while the detail stays available.
 */

export default function TaskCompose({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('backlogs');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [linkedIssueId, setLinkedIssueId] = useState('');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspaceMembers()
      .then((result) => setMembers(result.members))
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const datesWrong = Boolean(startDate && dueDate && startDate > dueDate);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || datesWrong) return;

    setBusy(true);
    setError(null);
    try {
      await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeId: assigneeId || null,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        linkedIssueId: linkedIssueId.trim() || null,
      });
      onCreated();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="panel-scrim" aria-label="Close" onClick={onClose} />
      <form className="compose" onSubmit={save} role="dialog" aria-label="Create a task">
        <header className="compose-head">
          <h2>Create a task</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="compose-body">
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <label className="field plain">
            <span>Task name</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Fix AES encryption on high value fields"
              maxLength={200}
            />
          </label>

          <label className="field plain">
            <span>Background</span>
            <textarea
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is the problem, and why does it matter?"
            />
          </label>

          <div className="compose-grid">
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
              <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
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

            <label className="field plain">
              <span>Linked issue</span>
              <input
                value={linkedIssueId}
                onChange={(event) => setLinkedIssueId(event.target.value)}
                placeholder="CVE-2026-1188"
                maxLength={80}
              />
            </label>

            <label className="field plain">
              <span>Starts</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>

            <label className="field plain">
              <span>Due</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          {datesWrong && (
            <p className="field-error" role="alert">
              The due date comes before the start date.
            </p>
          )}

          <p className="field-hint">
            This task will sit in <strong>{STATUS_LABEL[status]}</strong>, which counts as{' '}
            {STATUS_CATEGORY[status].replace('_', ' ')}.
          </p>
        </div>

        <footer className="compose-foot">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy || !title.trim() || datesWrong}>
            {busy ? 'Creating' : 'Create task'}
          </button>
        </footer>
      </form>
    </>
  );
}
