import type { AuditFilter, AuditPage, ExportFormat } from '../../shared/audit';
import type { Subscription, Usage } from '../../shared/plans';
import type { Schedule, SaveScheduleRequest } from '../../shared/schedules';
import type {
  CreateTaskRequest,
  Folder,
  Project,
  Task,
  TaskList,
  TimelineEntry,
  TaskAttachment,
  UpdateTaskRequest,
} from '../../shared/tasks';
import type {
  ApiError,
  CreateInvitationRequest,
  CreateInvitationResponse,
  DeleteAccountRequest,
  InvitationPreview,
  LoginRequest,
  PublicOrganization,
  PublicUser,
  SessionPayload,
  SignupRequest,
  UpdateEmailRequest,
  UpdateMemberRequest,
  UpdatePasswordRequest,
  UpdateProfileRequest,
  UpdateWorkspaceRequest,
  WorkspaceInvitation,
  WorkspaceMember,
} from '../../shared/api';
import type {
  AlertRule,
  ContactPoint,
  NotificationPolicy,
  SaveAlertRuleRequest,
  SaveContactPointRequest,
  SaveNotificationPolicyRequest,
} from '../../shared/alerting';
import type {
  Heartbeat,
  Monitor,
  MonitorSummary,
  SaveMonitorRequest,
} from '../../shared/argus';

/**
 * The one place the browser talks to the API.
 *
 * Vite proxies /api to port 4000, so every path here is relative and the
 * session cookie stays same origin. Each call either returns the parsed body
 * or throws an ApiFailure. No caller reads a status code.
 */

type Failure = ApiError['error'];

export class ApiFailure extends Error {
  readonly code: Failure['code'];
  /** Field name to message. Empty when the failure is not per field. */
  readonly fields: Record<string, string>;

  constructor(failure: Failure) {
    super(failure.message);
    this.name = 'ApiFailure';
    this.code = failure.code;
    this.fields = failure.fields ?? {};
  }
}

const OFFLINE: Failure = {
  code: 'server_error',
  message: 'Cerberus cannot reach the API. Check that it runs on port 4000.',
};

const UNREADABLE: Failure = {
  code: 'server_error',
  message: 'The API sent a reply that Cerberus cannot read.',
};

/**
 * Reads the Cerberus error shape out of a reply, or returns null.
 *
 * A Fastify 404 and a proxy error both send JSON that is not this shape, so
 * the check is explicit rather than a cast.
 */
function toFailure(body: unknown): Failure | null {
  if (typeof body !== 'object' || body === null) return null;

  const candidate = (body as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return null;

  const { code, message } = candidate as Partial<Failure>;
  if (typeof code !== 'string' || typeof message !== 'string') return null;

  return candidate as Failure;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  /**
   * Only a request that carries a body declares a type.
   *
   * Fastify refuses a request that announces JSON and then sends nothing, so
   * a bodyless DELETE or POST must stay silent about its content type. An
   * upload names its own type, and that one is left alone.
   */
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }

  try {
    response = await fetch(path, {
      ...init,
      // The session cookie rides on every call.
      credentials: 'include',
      headers,
    });
  } catch {
    // A dead port, a refused connection, or a dropped network lands here.
    throw new ApiFailure(OFFLINE);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  let readable = true;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // A proxy page or an HTML error reaches here instead of JSON.
      readable = false;
    }
  }

  if (!response.ok) {
    const failure = toFailure(body);
    if (failure) throw new ApiFailure(failure);

    // The reply carries no Cerberus error, so the API did not write it. The
    // Vite proxy answers 500 with an empty body when port 4000 is down, and
    // that is the common case, so say so.
    throw new ApiFailure(response.status >= 500 ? OFFLINE : UNREADABLE);
  }

  if (!readable) throw new ApiFailure(UNREADABLE);

  return body as T;
}

export function signup(body: SignupRequest): Promise<SessionPayload> {
  return request<SessionPayload>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });
}

export function login(body: LoginRequest): Promise<SessionPayload> {
  return request<SessionPayload>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

/** Returns the signed-in user, or null when nobody is signed in. */
export async function me(): Promise<SessionPayload | null> {
  try {
    return await request<SessionPayload>('/api/auth/me');
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'unauthorized') return null;
    throw error;
  }
}

export function updateProfile(body: UpdateProfileRequest): Promise<PublicUser> {
  return request<PublicUser>('/api/profile', { method: 'PATCH', body: JSON.stringify(body) });
}

export function updateEmail(body: UpdateEmailRequest): Promise<PublicUser> {
  return request<PublicUser>('/api/profile/email', { method: 'PATCH', body: JSON.stringify(body) });
}

export function updatePassword(body: UpdatePasswordRequest): Promise<void> {
  return request<void>('/api/profile/password', { method: 'PATCH', body: JSON.stringify(body) });
}

/** Sends the cropped square. The blob carries its own type, so the header does too. */
export function uploadAvatar(blob: Blob): Promise<PublicUser> {
  return request<PublicUser>('/api/profile/avatar', {
    method: 'PUT',
    body: blob,
    headers: { 'content-type': blob.type },
  });
}

export function removeAvatar(): Promise<PublicUser> {
  return request<PublicUser>('/api/profile/avatar', { method: 'DELETE' });
}

export function deleteAccount(body: DeleteAccountRequest): Promise<void> {
  return request<void>('/api/profile', { method: 'DELETE', body: JSON.stringify(body) });
}

export function workspaceMembers(): Promise<{ members: WorkspaceMember[] }> {
  return request<{ members: WorkspaceMember[] }>('/api/workspace/members');
}

export function updateWorkspace(body: UpdateWorkspaceRequest): Promise<PublicOrganization> {
  return request<PublicOrganization>('/api/workspace', { method: 'PATCH', body: JSON.stringify(body) });
}

export function updateMember(membershipId: string, body: UpdateMemberRequest): Promise<void> {
  return request<void>(`/api/workspace/members/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function removeMember(membershipId: string): Promise<void> {
  return request<void>(`/api/workspace/members/${membershipId}`, { method: 'DELETE' });
}

export function listInvitations(): Promise<{ invitations: WorkspaceInvitation[] }> {
  return request<{ invitations: WorkspaceInvitation[] }>('/api/invitations');
}

export function createInvitation(body: CreateInvitationRequest): Promise<CreateInvitationResponse> {
  return request<CreateInvitationResponse>('/api/invitations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function revokeInvitation(id: string): Promise<void> {
  return request<void>(`/api/invitations/${id}`, { method: 'DELETE' });
}

/** Reads a link without a session. The holder may have no account yet. */
export function previewInvitation(token: string): Promise<InvitationPreview> {
  return request<InvitationPreview>(`/api/invitations/token/${token}`);
}

export function acceptInvitation(token: string): Promise<{ workspaceName: string }> {
  return request<{ workspaceName: string }>(`/api/invitations/token/${token}/accept`, { method: 'POST' });
}

/* --------------------------------------------------------------- alerting -- */

export function listAlertRules(): Promise<{ rules: AlertRule[] }> {
  return request<{ rules: AlertRule[] }>('/api/alerting/rules');
}

export function createAlertRule(body: SaveAlertRuleRequest): Promise<AlertRule> {
  return request<AlertRule>('/api/alerting/rules', { method: 'POST', body: JSON.stringify(body) });
}

export function updateAlertRule(id: string, body: Partial<SaveAlertRuleRequest>): Promise<AlertRule> {
  return request<AlertRule>(`/api/alerting/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteAlertRule(id: string): Promise<void> {
  return request<void>(`/api/alerting/rules/${id}`, { method: 'DELETE' });
}

export function listContactPoints(): Promise<{ contactPoints: ContactPoint[] }> {
  return request<{ contactPoints: ContactPoint[] }>('/api/alerting/contact-points');
}

export function createContactPoint(body: SaveContactPointRequest): Promise<ContactPoint> {
  return request<ContactPoint>('/api/alerting/contact-points', { method: 'POST', body: JSON.stringify(body) });
}

export function updateContactPoint(id: string, body: SaveContactPointRequest): Promise<ContactPoint> {
  return request<ContactPoint>(`/api/alerting/contact-points/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteContactPoint(id: string): Promise<void> {
  return request<void>(`/api/alerting/contact-points/${id}`, { method: 'DELETE' });
}

export function getNotificationPolicy(): Promise<NotificationPolicy> {
  return request<NotificationPolicy>('/api/alerting/policy');
}

export function saveNotificationPolicy(body: SaveNotificationPolicyRequest): Promise<NotificationPolicy> {
  return request<NotificationPolicy>('/api/alerting/policy', { method: 'PUT', body: JSON.stringify(body) });
}

/* ------------------------------------------------------------------ tasks -- */

/** A project, with its folders and lists already attached. */
export type ProjectTree = Project & {
  taskCount: number;
  folders: Folder[];
  lists: TaskList[];
};

export function listProjects(): Promise<{ projects: ProjectTree[] }> {
  return request<{ projects: ProjectTree[] }>('/api/projects');
}

export function createProject(body: { name: string; key: string; description?: string }): Promise<ProjectTree> {
  return request<ProjectTree>('/api/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function createFolder(body: { projectId: string; name: string }): Promise<Folder> {
  return request<Folder>('/api/folders', { method: 'POST', body: JSON.stringify(body) });
}

export function createList(body: { projectId: string; folderId?: string | null; name: string }): Promise<TaskList> {
  return request<TaskList>('/api/lists', { method: 'POST', body: JSON.stringify(body) });
}

export function listTasks(
  query: {
    status?: string;
    priority?: string;
    assigneeId?: string;
    /** 'only' is the archive folder. 'true' returns live and archived together. */
    archived?: 'only' | boolean;
  } = {},
): Promise<{ tasks: Task[] }> {
  const search = new URLSearchParams();
  if (query.status) search.set('status', query.status);
  if (query.priority) search.set('priority', query.priority);
  if (query.assigneeId) search.set('assigneeId', query.assigneeId);
  if (query.archived) search.set('archived', query.archived === 'only' ? 'only' : 'true');
  const tail = search.toString();
  return request<{ tasks: Task[] }>(`/api/tasks${tail ? `?${tail}` : ''}`);
}

export function getTask(id: string): Promise<{ task: Task; timeline: TimelineEntry[]; attachments: TaskAttachment[] }> {
  return request<{ task: Task; timeline: TimelineEntry[]; attachments: TaskAttachment[] }>(`/api/tasks/${id}`);
}

export function createTask(body: CreateTaskRequest): Promise<Task> {
  return request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
}

export function updateTask(id: string, body: UpdateTaskRequest): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function archiveTask(id: string, archived = true): Promise<void> {
  return request<void>(`/api/tasks/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived }) });
}

/** Deletes for good. The API refuses unless the task is archived first. */
export function deleteTask(id: string): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function addComment(taskId: string, body: string): Promise<TimelineEntry> {
  return request<TimelineEntry>(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function uploadTaskAttachment(taskId: string, file: File, commentId?: string): Promise<TaskAttachment> {
  const search = new URLSearchParams();
  if (commentId) search.set('commentId', commentId);

  return request<TaskAttachment>(`/api/tasks/${taskId}/attachments${search.toString() ? `?${search}` : ''}`, {
    method: 'POST',
    body: file,
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name || 'attachment'),
    },
  });
}

/* -------------------------------------------------------------- schedules -- */

export function listSchedules(): Promise<{ schedules: Schedule[] }> {
  return request<{ schedules: Schedule[] }>('/api/schedules');
}

export function createSchedule(body: SaveScheduleRequest): Promise<Schedule> {
  return request<Schedule>('/api/schedules', { method: 'POST', body: JSON.stringify(body) });
}

export function updateSchedule(id: string, body: Partial<SaveScheduleRequest>): Promise<Schedule> {
  return request<Schedule>(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteSchedule(id: string): Promise<void> {
  return request<void>(`/api/schedules/${id}`, { method: 'DELETE' });
}

/** Fires it now, without waiting for its time. */
export function runScheduleNow(id: string): Promise<{ ran: boolean }> {
  return request<{ ran: boolean }>(`/api/schedules/${id}/run`, { method: 'POST' });
}

/* ---------------------------------------------------------- notifications -- */

export type AppNotification = {
  id: string;
  source: 'schedule' | 'alert' | 'task' | 'workspace';
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

/** A message from Cerberus itself, rather than from this workspace. */
export type Announcement = {
  id: string;
  kind: 'update' | 'promotion' | 'notice';
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  publishedAt: string;
};

export type BellFeed = {
  notifications: AppNotification[];
  announcements: Announcement[];
  unread: number;
  unreadNews: number;
};

export function listNotifications(): Promise<BellFeed> {
  return request<BellFeed>('/api/notifications');
}

/** Marks one as read, or everything when no id is given. */
export function markNotificationsRead(id?: string): Promise<void> {
  return request<void>('/api/notifications/read', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  });
}

/** The same, for announcements. Read state is per person. */
export function markAnnouncementsRead(id?: string): Promise<void> {
  return request<void>('/api/announcements/read', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  });
}

/**
 * The address of the picture, or null when there is none.
 *
 * The write time rides in the query, so a new picture defeats the cache the
 * API asks for without any cache busting on the server.
 */
export function avatarUrl(user: PublicUser): string | null {
  if (!user.avatarUpdatedAt) return null;
  return `/api/profile/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

/* ----------------------------------------------------------------- argus -- */

export function listMonitors(): Promise<{ monitors: MonitorSummary[] }> {
  return request<{ monitors: MonitorSummary[] }>('/api/argus/monitors');
}

export function getMonitor(id: string): Promise<{ monitor: Monitor }> {
  return request<{ monitor: Monitor }>('/api/argus/monitors/' + id);
}

export function createMonitor(body: SaveMonitorRequest): Promise<Monitor> {
  return request<Monitor>('/api/argus/monitors', { method: 'POST', body: JSON.stringify(body) });
}

export function updateMonitor(id: string, body: Partial<SaveMonitorRequest>): Promise<Monitor> {
  return request<Monitor>('/api/argus/monitors/' + id, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteMonitor(id: string): Promise<void> {
  return request<void>('/api/argus/monitors/' + id, { method: 'DELETE' });
}

export function pauseMonitor(id: string): Promise<Monitor> {
  return request<Monitor>('/api/argus/monitors/' + id + '/pause', { method: 'POST' });
}

export function resumeMonitor(id: string): Promise<Monitor> {
  return request<Monitor>('/api/argus/monitors/' + id + '/resume', { method: 'POST' });
}

export function resetMonitor(id: string): Promise<Monitor> {
  return request<Monitor>('/api/argus/monitors/' + id + '/reset', { method: 'POST' });
}

export function listHeartbeats(
  monitorId: string,
  query: { limit?: number; since?: string } = {},
): Promise<{ heartbeats: Heartbeat[] }> {
  const search = new URLSearchParams();
  if (query.limit) search.set('limit', String(query.limit));
  if (query.since) search.set('since', query.since);
  const tail = search.toString();
  return request<{ heartbeats: Heartbeat[] }>('/api/argus/monitors/' + monitorId + '/heartbeats' + (tail ? '?' + tail : ''));
}

/* ------------------------------------------------------------------- inbox -- */

export type InboxConversationSummary = {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  otherUser: {
    id: string;
    fullName: string;
    email: string;
    avatarUpdatedAt: string | null;
  };
  lastMessage: {
    body: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
};

export type InboxMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  sender: {
    id: string;
    fullName: string;
    email: string;
    avatarUpdatedAt: string | null;
  };
};

export type InboxMember = {
  userId: string;
  fullName: string;
  email: string;
  avatarUpdatedAt: string | null;
};

export function listConversations(): Promise<{ conversations: InboxConversationSummary[] }> {
  return request<{ conversations: InboxConversationSummary[] }>('/api/inbox/conversations');
}

export function createConversation(userId: string): Promise<{ conversation: { id: string; createdAt: string; updatedAt: string } }> {
  return request('/api/inbox/conversations', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function listMessages(
  conversationId: string,
  query: { limit?: number; before?: string } = {},
): Promise<{ messages: InboxMessage[] }> {
  const search = new URLSearchParams();
  if (query.limit) search.set('limit', String(query.limit));
  if (query.before) search.set('before', query.before);
  const tail = search.toString();
  return request('/api/inbox/conversations/' + conversationId + '/messages' + (tail ? '?' + tail : ''));
}

export function sendMessage(
  conversationId: string,
  body: string,
  replyToId?: string,
): Promise<{ message: InboxMessage }> {
  return request('/api/inbox/conversations/' + conversationId + '/messages', {
    method: 'POST',
    body: JSON.stringify({ body, replyToId }),
  });
}

export function markConversationRead(conversationId: string): Promise<void> {
  return request('/api/inbox/conversations/' + conversationId + '/read', { method: 'POST' });
}

export function listInboxMembers(): Promise<{ members: InboxMember[] }> {
  return request<{ members: InboxMember[] }>('/api/inbox/members');
}

/* ------------------------------------------------------------------ plan -- */

export type PlanPayload = {
  subscription: Subscription;
  usage: Usage;
};

/** What the workspace pays for, and what it currently holds. */
export function getPlan(): Promise<PlanPayload> {
  return request<PlanPayload>('/api/plan');
}

/* ----------------------------------------------------------------- audit -- */

import { filterToQuery } from '../../shared/audit';

export function listAudit(filter: AuditFilter, page = 0): Promise<AuditPage> {
  const query = filterToQuery(filter);
  const parts = [query, page > 0 ? `page=${page}` : ''].filter(Boolean).join('&');
  return request<AuditPage>(`/api/audit${parts ? `?${parts}` : ''}`);
}

export function listAuditActors(): Promise<{ actors: string[] }> {
  return request<{ actors: string[] }>('/api/audit/actors');
}

/**
 * The export URL.
 *
 * A plain navigation rather than a fetch, so the browser saves the file itself
 * and the session cookie rides along with the request.
 */
export function auditExportUrl(filter: AuditFilter, format: ExportFormat): string {
  const query = filterToQuery(filter);
  return `/api/audit/export?format=${format}${query ? `&${query}` : ''}`;
}
