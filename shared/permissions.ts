import type { AccountType, MemberRole, WorkspacePolicy } from './api.js';

/**
 * Who may do what.
 *
 * Both the browser and the API import this file. The browser uses it to hide
 * a control. The API uses it to refuse a request. A hidden control is a
 * courtesy, never a control, so the API always asks again.
 *
 * Keep the rule here and nowhere else. A second copy is how a screen and a
 * server start to disagree.
 */

export type Permission =
  /** See the workspace and everything already in it. */
  | 'workspace.view'
  | 'issue.resolve'
  /** Create and change tasks, and comment on them. */
  | 'task.manage'
  | 'project.create'
  | 'alert.manage'
  | 'member.invite'
  /** Change somebody's role, or remove them. */
  | 'member.manage'
  | 'workspace.settings'
  | 'workspace.billing'
  | 'workspace.delete';

export type PermissionContext = {
  role: MemberRole;
  kind: AccountType;
  policy: WorkspacePolicy;
};

/** Every switch reads as on inside a flat workspace. */
export const FLAT_POLICY: WorkspacePolicy = {
  membersCanInvite: true,
  membersCanCreateProjects: true,
  membersCanManageAlerts: true,
};

export function can(permission: Permission, context: PermissionContext): boolean {
  const { role, kind, policy } = context;

  // Money and the existence of the workspace stay with one person.
  if (permission === 'workspace.billing' || permission === 'workspace.delete') {
    return role === 'owner';
  }

  // A viewer reads and nothing else. This holds in every kind of workspace.
  if (role === 'viewer') return permission === 'workspace.view';

  if (role === 'owner' || role === 'admin') return true;

  // A personal workspace is flat, so a member works at the owner's level.
  if (kind === 'personal') return true;

  switch (permission) {
    case 'workspace.view':
    case 'issue.resolve':
    // Tracking the work is the point of the module, so every member does it.
    case 'task.manage':
      return true;
    case 'member.invite':
      return policy.membersCanInvite;
    case 'project.create':
      return policy.membersCanCreateProjects;
    case 'alert.manage':
      return policy.membersCanManageAlerts;
    default:
      return false;
  }
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_BLURB: Record<MemberRole, string> = {
  owner: 'Runs the workspace. Holds billing, and can delete it.',
  admin: 'Runs the day to day. Invites people and changes settings.',
  member: 'Works the queue. The policy switches decide the rest.',
  viewer: 'Reads everything. Changes nothing.',
};

/** The roles somebody may be given. An owner is made by transfer, not choice. */
export const ASSIGNABLE_ROLES: MemberRole[] = ['admin', 'member', 'viewer'];
