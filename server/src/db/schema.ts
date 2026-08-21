import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Postgres bytea. Drizzle ships no built-in column type for it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * The core tenancy model.
 *
 * Every account owns an organization, including a personal one. A personal
 * signup still creates an organization row with kind 'personal'. That keeps one
 * scoping rule for the whole product: every future table carries an
 * organization_id, and no query has to special case a user without a team.
 */

export const orgKind = pgEnum('org_kind', ['personal', 'organization']);
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer']);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: orgKind('kind').notNull(),
    teamSize: text('team_size'),
    useCase: text('use_case'),
    /**
     * What a plain member may do. An owner and an admin ignore these. A
     * personal workspace ignores them too, because it is flat.
     */
    membersCanInvite: boolean('members_can_invite').notNull().default(false),
    membersCanCreateProjects: boolean('members_can_create_projects').notNull().default(true),
    membersCanManageAlerts: boolean('members_can_manage_alerts').notNull().default(false),
    /** The prefix on every task ref, such as TSK in TSK-142. */
    taskPrefix: text('task_prefix').notNull().default('TSK'),
    /** The next number this workspace hands out to a task. */
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('organizations_slug_key').on(table.slug)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Always stored lower case. Normalize with normalizeEmail before writing.
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    githubHandle: text('github_handle'),
    primaryStack: text('primary_stack'),
    /**
     * The profile picture, already cropped and resized by the browser. It is
     * small enough to sit beside the row, so there is no bucket to run.
     */
    avatar: bytea('avatar'),
    avatarType: text('avatar_type'),
    avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    /** What the person does, taken from the signup form. Not a permission. */
    jobTitle: text('job_title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_user_org_key').on(table.userId, table.organizationId),
    index('memberships_org_idx').on(table.organizationId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie value. The raw token never touches the database. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

/**
 * A pending invitation.
 *
 * The link carries a random token. The row keeps only its SHA-256, exactly as
 * a session does, so reading this table gives nobody a way in.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Always stored lower case. The address the invitation names. */
    email: text('email').notNull(),
    role: memberRole('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_token_hash_key').on(table.tokenHash),
    index('invitations_org_idx').on(table.organizationId),
    index('invitations_email_idx').on(table.email),
  ],
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
}));

/* ------------------------------------------------------------- alerting -- */

/**
 * A rule decides what is worth waking somebody about.
 *
 * It never names a contact point. It attaches labels, and the policy routes on
 * those labels, so who is on call changes without touching a rule.
 */
export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    /** The severity the rule gives its own alert. See shared/severity.ts. */
    severity: text('severity').notNull().default('high'),
    /** The match condition. See AlertCondition in shared/alerting.ts. */
    condition: jsonb('condition').notNull(),
    /** Attached to every alert this rule fires. The policy routes on these. */
    labels: jsonb('labels').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('alert_rules_org_idx').on(table.organizationId)],
);

/**
 * A contact point decides how a person hears about an alert.
 *
 * Public settings sit in `integrations`. Anything secret, such as a webhook
 * URL, sits in `secrets` and never travels back to the browser.
 */
export const contactPoints = pgTable(
  'contact_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    integrations: jsonb('integrations').notNull().default([]),
    secrets: jsonb('secrets').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_points_org_idx').on(table.organizationId),
    uniqueIndex('contact_points_org_name_key').on(table.organizationId, table.name),
  ],
);

/**
 * One row per workspace. The root of the routing.
 *
 * Anything no route claims lands on the default contact point, so an alert can
 * never be silently dropped.
 */
export const notificationPolicies = pgTable(
  'notification_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    defaultContactPointId: uuid('default_contact_point_id').references(() => contactPoints.id, {
      onDelete: 'set null',
    }),
    groupBy: jsonb('group_by').notNull().default(['severity', 'source']),
    groupWaitSeconds: integer('group_wait_seconds').notNull().default(30),
    groupIntervalSeconds: integer('group_interval_seconds').notNull().default(300),
    repeatIntervalSeconds: integer('repeat_interval_seconds').notNull().default(14400),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('notification_policies_org_key').on(table.organizationId)],
);

/** An ordered test against an alert's labels. Lower position runs first. */
export const notificationRoutes = pgTable(
  'notification_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    matchers: jsonb('matchers').notNull().default([]),
    contactPointId: uuid('contact_point_id')
      .notNull()
      .references(() => contactPoints.id, { onDelete: 'cascade' }),
    continueMatching: boolean('continue_matching').notNull().default(false),
  },
  (table) => [index('notification_routes_org_idx').on(table.organizationId, table.position)],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [sessions.organizationId],
    references: [organizations.id],
  }),
}));

/* ------------------------------------------------------------------ tasks -- */

/**
 * Work tracking.
 *
 *   projects → folders → lists → tasks → subtasks → checklist items
 *
 * A folder is optional: a list carries a folder_id that may be null, so a
 * small project never pays for a level it does not use.
 */

export const taskStatus = pgEnum('task_status', [
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
]);

export const taskPriority = pgEnum('task_priority', ['urgent', 'high', 'normal', 'low']);

export const taskEvent = pgEnum('task_event', [
  'created',
  'status',
  'priority',
  'assignee',
  'dates',
  'archived',
  'restored',
  'linked_issue',
]);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The task ref prefix, such as PWA. Unique inside the workspace. */
    key: text('key').notNull(),
    description: text('description'),
    /**
     * The next number this project will hand out.
     *
     * Held here rather than in a Postgres sequence so each project counts from
     * one, and so the counter is scoped and deleted with its project.
     */
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_org_key_idx').on(table.organizationId, table.key),
    index('projects_org_idx').on(table.organizationId),
  ],
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('folders_project_idx').on(table.projectId)],
);

export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Null when the list sits straight under its project. */
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('lists_project_idx').on(table.projectId), index('lists_folder_idx').on(table.folderId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * Optional. A task belongs to the workspace, not to a project. These stay
     * so a task can be filed under one later, but nothing requires it.
     */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    listId: uuid('list_id').references(() => lists.id, { onDelete: 'set null' }),
    /** Counts from one within the workspace. The ref is the prefix plus this. */
    number: integer('number').notNull(),
    /**
     * Set when this task is a subtask. A subtask never has its own subtasks.
     *
     * The self reference needs the lazy callback form, because the table is
     * still being defined at this point. Deleting a parent takes its subtasks
     * rather than leaving them orphaned.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('backlogs'),
    priority: taskPriority('priority').notNull().default('normal'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    startDate: timestamp('start_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    /** Stored, but nothing sends it yet. */
    remindAt: timestamp('remind_at', { withTimezone: true }),
    /** The security finding this work closes. Free text until Issues lands. */
    linkedIssueId: text('linked_issue_id'),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tasks_org_number_idx').on(table.organizationId, table.number),
    index('tasks_list_idx').on(table.listId),
    index('tasks_parent_idx').on(table.parentId),
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_org_status_idx').on(table.organizationId, table.status),
  ],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (table) => [index('checklist_task_idx').on(table.taskId)],
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [index('task_comments_task_idx').on(table.taskId)],
);

/**
 * A file on a task.
 *
 * The bytes sit in Postgres, as the avatar does, which is why the size is
 * capped hard. Swapping this for object storage means changing this table and
 * the upload route, and nothing else.
 */
export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Set when the file was posted with a comment rather than on the task. */
    commentId: uuid('comment_id').references(() => taskComments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_attachments_task_idx').on(table.taskId)],
);

/** What happened to a task. Interleaved with comments to make the timeline. */
export const taskActivity = pgTable(
  'task_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    event: taskEvent('event').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_activity_task_idx').on(table.taskId)],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  folders: many(folders),
  lists: many(lists),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  list: one(lists, { fields: [tasks.listId], references: [lists.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  comments: many(taskComments),
  attachments: many(taskAttachments),
  activity: many(taskActivity),
  checklist: many(checklistItems),
}));

/* -------------------------------------------------------------- schedules -- */

export const scheduleKind = pgEnum('schedule_kind', ['reminder', 'task', 'report', 'scan']);
export const runOutcome = pgEnum('run_outcome', ['ok', 'failed', 'skipped']);

/**
 * A standing instruction: do this thing again and again, on a timer.
 *
 * next_run_at is stored rather than worked out on read, so finding what is due
 * is one indexed lookup however many schedules exist.
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: scheduleKind('kind').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** See Recurrence in shared/schedules.ts. */
    recurrence: jsonb('recurrence').notNull(),
    /** What to make when it fires. Shape follows the kind. */
    payload: jsonb('payload').notNull().default({}),
    /**
     * Where to send the result. Null means the bell only.
     *
     * This points at an alerting contact point on purpose. Who hears about a
     * thing is one idea, so it has one home.
     */
    contactPointId: uuid('contact_point_id').references(() => contactPoints.id, { onDelete: 'set null' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schedules_org_idx').on(table.organizationId),
    // The runner asks one question: what is due? This answers it.
    index('schedules_due_idx').on(table.enabled, table.nextRunAt),
  ],
);

/** One firing. Keeps the history honest, including the failures. */
export const scheduleRuns = pgTable(
  'schedule_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: runOutcome('outcome').notNull(),
    note: text('note'),
    /** Set when the run made a task. */
    createdTaskId: uuid('created_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  },
  (table) => [index('schedule_runs_schedule_idx').on(table.scheduleId)],
);

export const schedulesRelations = relations(schedules, ({ many }) => ({
  runs: many(scheduleRuns),
}));

/* ---------------------------------------------------------- notifications -- */

export const notificationSource = pgEnum('notification_source', ['schedule', 'alert', 'task', 'workspace']);

/**
 * What the bell shows.
 *
 * A notification is written whatever else happens, so a person always has one
 * place to look. Delivery to a contact point can fail; this cannot.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null means everybody in the workspace sees it. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: notificationSource('source').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Where clicking it should go, such as /scheduled. */
    href: text('href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_org_idx').on(table.organizationId, table.createdAt),
    index('notifications_unread_idx').on(table.organizationId, table.readAt),
  ],
);

/* --------------------------------------------------------- announcements -- */

export const announcementKind = pgEnum('announcement_kind', ['update', 'promotion', 'notice']);
export const announcementAudience = pgEnum('announcement_audience', ['all', 'personal', 'organization']);

/**
 * A message from Cerberus to everybody.
 *
 * It belongs to no workspace, which is what separates it from a notification.
 * Product news, a new module, an offer. Written once and seen by all.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: announcementKind('kind').notNull().default('update'),
    title: text('title').notNull(),
    body: text('body'),
    /** Where to send a person who wants the detail. */
    href: text('href'),
    /** Which accounts should see it. */
    audience: announcementAudience('audience').notNull().default('all'),
    /** Null means a draft. Nothing unpublished ever reaches the bell. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Null means it never expires. A promotion normally should. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('announcements_published_idx').on(table.publishedAt)],
);

/**
 * Who has read what.
 *
 * The read mark cannot live on the announcement, because one row is shared by
 * every person who sees it.
 */
export const announcementReads = pgTable(
  'announcement_reads',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('announcement_reads_key').on(table.announcementId, table.userId),
    index('announcement_reads_user_idx').on(table.userId),
  ],
);
