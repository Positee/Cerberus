import type { Severity } from './severity.js';

/**
 * Tasks.
 *
 * The shape is ClickUp's and the restraint is Todoist's. Six levels of
 * structure, because real work nests, but one obvious way to add a task and
 * depth that stays folded until somebody asks for it.
 *
 *   Project  →  Folder  →  List  →  Task  →  Subtask  →  Checklist item
 *
 * A folder is optional. A list may sit straight under its project, the way
 * ClickUp allows a folderless list, so a small project never pays for a level
 * it does not use.
 */

/* --------------------------------------------------------------- statuses -- */

export type TaskStatus =
  | 'backlogs'
  | 'pending'
  | 'ongoing'
  | 'investigating'
  | 'review'
  | 'qa'
  | 'monitoring'
  | 'pending_comments'
  | 'blocked'
  | 'kickback'
  | 'delayed'
  | 'completed'
  | 'cancelled';

/**
 * Thirteen statuses would be thirteen columns on a board, which nobody can
 * read. Each one belongs to a category, so the board can collapse to five
 * while the task keeps saying exactly where it is.
 */
export type StatusCategory = 'not_started' | 'active' | 'blocked' | 'done' | 'closed';

export const STATUS_ORDER: TaskStatus[] = [
  'backlogs',
  'pending',
  'ongoing',
  'investigating',
  'review',
  'qa',
  'monitoring',
  'pending_comments',
  'blocked',
  'kickback',
  'delayed',
  'completed',
  'cancelled',
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlogs: 'Backlogs',
  pending: 'Pending',
  ongoing: 'Ongoing',
  investigating: 'Investigating',
  review: 'Review',
  qa: 'QA',
  monitoring: 'Monitoring',
  pending_comments: 'Pending comments',
  blocked: 'Blocked',
  kickback: 'Kickback',
  delayed: 'Delayed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_CATEGORY: Record<TaskStatus, StatusCategory> = {
  backlogs: 'not_started',
  pending: 'not_started',
  ongoing: 'active',
  investigating: 'active',
  review: 'active',
  qa: 'active',
  monitoring: 'active',
  pending_comments: 'active',
  blocked: 'blocked',
  kickback: 'blocked',
  delayed: 'blocked',
  completed: 'done',
  cancelled: 'closed',
};

export const CATEGORY_ORDER: StatusCategory[] = ['not_started', 'active', 'blocked', 'done', 'closed'];

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  not_started: 'Not started',
  active: 'Active',
  blocked: 'Blocked',
  done: 'Done',
  closed: 'Closed',
};

/** A task in a done or closed category is finished, whatever its status says. */
export function isSettled(status: TaskStatus): boolean {
  const category = STATUS_CATEGORY[status];
  return category === 'done' || category === 'closed';
}

export function statusesIn(category: StatusCategory): TaskStatus[] {
  return STATUS_ORDER.filter((status) => STATUS_CATEGORY[status] === category);
}

/* -------------------------------------------------------------- priority -- */

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/* --------------------------------------------------------------- records -- */

export type Project = {
  id: string;
  name: string;
  /** The task ID prefix, such as PWA. Upper case, two to six letters. */
  key: string;
  description: string | null;
  archived: boolean;
  createdAt: string;
};

export type Folder = {
  id: string;
  projectId: string;
  name: string;
  position: number;
  archived: boolean;
};

export type TaskList = {
  id: string;
  projectId: string;
  /** Null when the list sits straight under its project. */
  folderId: string | null;
  name: string;
  position: number;
  archived: boolean;
};

export type TaskPerson = {
  id: string;
  fullName: string;
  email: string;
};

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  position: number;
};

export type TaskAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: TaskPerson | null;
  createdAt: string;
};

/**
 * One entry in the task's timeline.
 *
 * A comment and a status change share the stream, so the whole story of a
 * task reads from top to bottom without switching tabs.
 */
export type TimelineEntry =
  | {
      kind: 'comment';
      id: string;
      author: TaskPerson | null;
      body: string;
      attachments: TaskAttachment[];
      createdAt: string;
      editedAt: string | null;
    }
  | {
      kind: 'event';
      id: string;
      actor: TaskPerson | null;
      event: TaskEvent;
      from: string | null;
      to: string | null;
      createdAt: string;
    };

export type TaskEvent =
  | 'created'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'dates'
  | 'archived'
  | 'restored'
  | 'linked_issue';

export const EVENT_PHRASE: Record<TaskEvent, string> = {
  created: 'created this task',
  status: 'moved this to',
  priority: 'set priority to',
  assignee: 'assigned this to',
  dates: 'changed the timeline',
  archived: 'archived this',
  restored: 'restored this',
  linked_issue: 'linked an issue',
};

export type Task = {
  id: string;
  /** The readable identifier, such as PWA-142. Unique in the workspace. */
  ref: string;
  /** A task belongs to the workspace. These are set only when it is filed. */
  listId: string | null;
  projectId: string | null;
  /** Set when this task is a subtask of another. */
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskPerson | null;
  startDate: string | null;
  dueDate: string | null;
  /** When the reminder should fire. Nothing sends it yet. */
  remindAt: string | null;
  archived: boolean;
  position: number;
  createdBy: TaskPerson | null;
  createdAt: string;
  updatedAt: string;
  /** The security finding this work closes, when there is one. */
  linkedIssue: { id: string; ref: string; title: string; severity: Severity } | null;
  checklist: ChecklistItem[];
  subtaskCount: number;
  commentCount: number;
  attachmentCount: number;
};

/* -------------------------------------------------------------- requests -- */

export type CreateTaskRequest = {
  listId?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  parentId?: string | null;
  linkedIssueId?: string | null;
};

export type UpdateTaskRequest = Partial<Omit<CreateTaskRequest, 'parentId'>> & {
  remindAt?: string | null;
};

/** How a list of tasks is arranged on screen. */
export type GroupBy = 'status' | 'category' | 'assignee' | 'priority' | 'none';

export const GROUP_LABEL: Record<GroupBy, string> = {
  status: 'Status',
  category: 'Category',
  assignee: 'Assignee',
  priority: 'Priority',
  none: 'Nothing',
};

/** The project key, derived from its name. The person may overwrite it. */
export function suggestKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'TSK';
  // One word gives its first letters. Several give their initials.
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).padEnd(2, 'X');

  return words
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 4);
}

export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

/** Attachments live in Postgres for now, so they stay small on purpose. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
