/**
 * The audit trail.
 *
 * One row for every action a person takes, allowed or denied. The browser reads
 * these labels and the API writes the rows, so both sides name an action the
 * same way.
 *
 * An action is written in the past tense of what happened, not what was asked
 * for. A denied row means somebody tried and was refused, which is the row an
 * auditor most wants to find.
 */

export type AuditResult = 'allowed' | 'denied';

/**
 * What was done.
 *
 * The string is dotted and stable, because it ends up in exported evidence.
 * Renaming one breaks every report anybody has already filed.
 */
export type AuditAction =
  // Getting in
  | 'auth.login'
  | 'auth.logout'
  | 'auth.signup'
  // The person
  | 'profile.update'
  | 'profile.email.change'
  | 'profile.password.change'
  | 'profile.avatar.set'
  | 'profile.avatar.remove'
  | 'account.delete'
  // The workspace
  | 'workspace.update'
  | 'workspace.policy.update'
  | 'member.invite'
  | 'member.role.change'
  | 'member.remove'
  | 'invitation.revoke'
  | 'invitation.accept'
  // Alerting
  | 'alert.rule.create'
  | 'alert.rule.update'
  | 'alert.rule.delete'
  | 'contact.point.create'
  | 'contact.point.update'
  | 'contact.point.delete'
  | 'notification.policy.update'
  // Work
  | 'project.create'
  | 'task.create'
  | 'task.update'
  | 'task.archive'
  | 'task.restore'
  | 'task.delete'
  | 'schedule.create'
  | 'schedule.update'
  | 'schedule.delete'
  | 'schedule.run'
  // Reading the trail is itself privileged, so it leaves a row.
  | 'audit.export'
  /** Somebody asked for something their role or plan forbids. */
  | 'permission.denied'
  // Uptime
  | 'monitor.create'
  | 'monitor.update'
  | 'monitor.delete'
  | 'monitor.pause'
  | 'monitor.resume'
  | 'monitor.reset'
  | 'folder.create'
  | 'list.create'
  | 'task.comment'
  | 'task.attach'
  | 'inbox.conversation.create'
  | 'inbox.message.send'
  | 'notification.read'
  | 'announcement.read'
  | 'inbox.conversation.read';

/** Read by a person scanning the log. Kept short enough to sit in a column. */
export const ACTION_LABEL: Record<AuditAction, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.signup': 'Created the account',
  'profile.update': 'Changed their details',
  'profile.email.change': 'Changed their email address',
  'profile.password.change': 'Changed their password',
  'profile.avatar.set': 'Set their picture',
  'profile.avatar.remove': 'Removed their picture',
  'account.delete': 'Deleted the account',
  'workspace.update': 'Changed the workspace',
  'workspace.policy.update': 'Changed what members may do',
  'member.invite': 'Invited somebody',
  'member.role.change': 'Changed a role',
  'member.remove': 'Removed a member',
  'invitation.revoke': 'Revoked an invitation',
  'invitation.accept': 'Joined the workspace',
  'alert.rule.create': 'Created an alert rule',
  'alert.rule.update': 'Changed an alert rule',
  'alert.rule.delete': 'Deleted an alert rule',
  'contact.point.create': 'Created a contact point',
  'contact.point.update': 'Changed a contact point',
  'contact.point.delete': 'Deleted a contact point',
  'notification.policy.update': 'Changed the routing',
  'project.create': 'Created a project',
  'task.create': 'Created a task',
  'task.update': 'Changed a task',
  'task.archive': 'Archived a task',
  'task.restore': 'Restored a task',
  'task.delete': 'Deleted a task for good',
  'schedule.create': 'Created a schedule',
  'schedule.update': 'Changed a schedule',
  'schedule.delete': 'Deleted a schedule',
  'schedule.run': 'Ran a schedule',
  'audit.export': 'Exported the audit log',
  'permission.denied': 'Was refused',
  'monitor.create': 'Created a monitor',
  'monitor.update': 'Changed a monitor',
  'monitor.delete': 'Deleted a monitor',
  'monitor.pause': 'Paused a monitor',
  'monitor.resume': 'Resumed a monitor',
  'monitor.reset': 'Reset a monitor',
  'folder.create': 'Created a folder',
  'list.create': 'Created a list',
  'task.comment': 'Commented on a task',
  'task.attach': 'Attached a file to a task',
  'inbox.conversation.create': 'Started a conversation',
  'inbox.message.send': 'Sent a message',
  'notification.read': 'Read a notification',
  'announcement.read': 'Read an announcement',
  'inbox.conversation.read': 'Read a conversation',
};

/** The groups the filter offers. An action belongs to exactly one. */
export type AuditCategory = 'access' | 'account' | 'workspace' | 'alerting' | 'work' | 'uptime';

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  access: 'Access',
  account: 'Account',
  workspace: 'Workspace',
  alerting: 'Alerting',
  work: 'Work',
  uptime: 'Uptime',
};

export function categoryOf(action: AuditAction): AuditCategory {
  if (action.startsWith('auth.')) return 'access';
  if (action.startsWith('profile.') || action === 'account.delete') return 'account';
  if (action.startsWith('workspace.') || action.startsWith('member.') || action.startsWith('invitation.')) {
    return 'workspace';
  }
  if (action.startsWith('alert.') || action.startsWith('contact.') || action.startsWith('notification.')) {
    return 'alerting';
  }
  if (action.startsWith('monitor.')) return 'uptime';
  if (action.startsWith('inbox.')) return 'work';
  if (action.startsWith('notification.') || action.startsWith('announcement.')) return 'account';
  if (action === 'audit.export' || action === 'permission.denied') return 'workspace';
  return 'work';
}

/** One row, as the browser sees it. */
export type AuditEvent = {
  id: string;
  /** The email of whoever acted, or "unknown" when a sign in failed. */
  actor: string;
  action: AuditAction;
  /** What was acted on, in words. Never an opaque id on its own. */
  resource: string;
  ip: string | null;
  at: string;
  result: AuditResult;
};

export type AuditPage = {
  events: AuditEvent[];
  /** Rows matching the filter, which may be more than this page holds. */
  total: number;
};

/** What narrows the log. Every field is optional, and they combine with AND. */
export type AuditFilter = {
  result?: AuditResult;
  category?: AuditCategory;
  actor?: string;
  /** ISO dates. from is inclusive, to is exclusive. */
  from?: string;
  to?: string;
};

/**
 * The most rows one export carries.
 *
 * Both sides read it. The API stops there, and the screen says so before
 * anybody downloads, because an evidence report that quietly drops rows is
 * worse than one that admits its limit.
 */
/** Rows in one page of the log. Both the API and the pager read it. */
export const PAGE_SIZE = 200;

export const EXPORT_CAP = 50000;

export const EXPORT_FORMATS = ['csv', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Turns a filter into a query string.
 *
 * The list and both exports read the same filter, so a downloaded report always
 * holds exactly the rows on screen.
 */
export function filterToQuery(filter: AuditFilter): string {
  const query = new URLSearchParams();
  if (filter.result) query.set('result', filter.result);
  if (filter.category) query.set('category', filter.category);
  if (filter.actor) query.set('actor', filter.actor);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  return query.toString();
}

/** Says what a filter covers, for the export button and the report heading. */
export function describeFilter(filter: AuditFilter): string {
  const parts: string[] = [];

  if (filter.result) parts.push(filter.result === 'allowed' ? 'allowed' : 'denied');
  parts.push(filter.category ? CATEGORY_LABEL[filter.category].toLowerCase() : 'all');
  if (filter.actor) parts.push(`by ${filter.actor}`);

  const span =
    filter.from && filter.to
      ? ` between ${filter.from} and ${filter.to}`
      : filter.from
        ? ` since ${filter.from}`
        : filter.to
          ? ` before ${filter.to}`
          : '';

  return `${parts.join(' ')} events${span}`;
}
