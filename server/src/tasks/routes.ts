import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql as raw } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  checklistItems,
  folders,
  lists,
  organizations,
  projects,
  taskActivity,
  taskAttachments,
  taskComments,
  tasks,
  users,
} from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record as auditRecord, recordDenied as auditRecordDenied } from '../audit/record.js';
import { notifyLater } from '../notifications/notify.js';
import { fail, fieldErrors } from '../http/errors.js';
import { needsPlan, withinLimit } from '../http/plan.js';
import { loadTaskActivityCounts } from './activity-counts.js';
import type { SessionPayload } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';
import {
  KEY_PATTERN,
  PRIORITY_ORDER,
  STATUS_ORDER,
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_TYPES,
  type Task,
  type TaskAttachment,
  type TaskEvent,
  type TaskPriority,
  type TaskStatus,
  type TimelineEntry,
} from '../../../shared/tasks.js';

/**
 * Projects, lists, and tasks.
 *
 *   projects -> folders -> lists -> tasks -> subtasks -> checklist items
 *
 * A task ref such as PWA-142 comes from its project key and a per project
 * counter. The counter is bumped inside the same transaction that writes the
 * task, so two people creating at once cannot collide.
 */

const statusField = z.enum(STATUS_ORDER as [TaskStatus, ...TaskStatus[]]);
const priorityField = z.enum(PRIORITY_ORDER as [TaskPriority, ...TaskPriority[]]);

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Name the project.').max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(KEY_PATTERN, 'Use two to six letters or digits, starting with a letter.'),
  description: z.string().trim().max(400).optional(),
});

const listSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, 'Name the list.').max(80),
});

const folderSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name the folder.').max(80),
});

const createTaskSchema = z.object({
  /** Optional. A task may be filed under a list, but nothing requires it. */
  listId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, 'Give the task a title.').max(200),
  description: z.string().trim().max(20000).optional(),
  status: statusField.optional(),
  priority: priorityField.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  linkedIssueId: z.string().trim().max(80).nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial().omit({ parentId: true }).extend({
  remindAt: z.string().datetime().nullable().optional(),
});

const allowedAttachmentTypes = new Set<string>(TASK_ATTACHMENT_TYPES);

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionPayload | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return null;
  }
  return session;
}

async function allow(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionPayload,
  permission: Permission,
): Promise<boolean> {
  const context = { role: session.role, kind: session.organization.kind, policy: session.organization.policy };
  if (can(permission, context)) return true;

  // A refusal is the row an auditor most wants, so it is written too.
  auditRecordDenied(request, {
    organizationId: session.organization.id,
    actorUserId: session.user.id,
    actor: session.user.email,
    action: 'permission.denied',
    resource: permission,
  });

  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

/** Writes one line of history. Every change to a task leaves a trace. */
async function record(
  taskId: string,
  actorId: string,
  event: TaskEvent,
  from: string | null,
  to: string | null,
): Promise<void> {
  await db.insert(taskActivity).values({ taskId, actorId, event, fromValue: from, toValue: to });
}

type TaskRow = typeof tasks.$inferSelect;
type AttachmentRow = typeof taskAttachments.$inferSelect;

function shapeTask(
  row: TaskRow,
  key: string,
  assignee: { id: string; fullName: string; email: string } | null,
  counts: { subtasks: number; comments: number; attachments: number },
  checklist: Task['checklist'],
): Task {
  return {
    id: row.id,
    ref: `${key}-${row.number}`,
    listId: row.listId,
    projectId: row.projectId,
    parentId: row.parentId,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    assignee,
    startDate: row.startDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    remindAt: row.remindAt?.toISOString() ?? null,
    archived: row.archivedAt !== null,
    position: row.position,
    createdBy: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    linkedIssue: row.linkedIssueId
      ? { id: row.linkedIssueId, ref: row.linkedIssueId, title: row.linkedIssueId, severity: 'high' }
      : null,
    checklist,
    subtaskCount: counts.subtasks,
    commentCount: counts.comments,
    attachmentCount: counts.attachments,
  };
}

function shapeAttachment(row: AttachmentRow, uploadedBy: TaskAttachment['uploadedBy'] = null): TaskAttachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function attachmentName(request: FastifyRequest): string {
  const raw = request.headers['x-file-name'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'attachment';

  try {
    return decodeURIComponent(value).replace(/[\\/\0]/g, '').trim().slice(0, 180) || 'attachment';
  } catch {
    return value.replace(/[\\/\0]/g, '').trim().slice(0, 180) || 'attachment';
  }
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/["\\\r\n]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export default async function taskRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------ projects -- */

  app.get('/api/projects', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const org = session.organization.id;

    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, org))
      .orderBy(asc(projects.name));

    const ids = projectRows.map((row) => row.id);

    // Two flat reads, then assembled in memory. The tree is small.
    const folderRows = ids.length ? await db.select().from(folders).where(inArray(folders.projectId, ids)) : [];
    const listRows = ids.length ? await db.select().from(lists).where(inArray(lists.projectId, ids)) : [];

    const openCounts = await db
      .select({ projectId: tasks.projectId, total: count() })
      .from(tasks)
      .where(and(eq(tasks.organizationId, org), isNull(tasks.archivedAt)))
      .groupBy(tasks.projectId);

    const totals = new Map(openCounts.map((row) => [row.projectId, Number(row.total)]));

    return reply.send({
      projects: projectRows.map((project) => ({
        id: project.id,
        name: project.name,
        key: project.key,
        description: project.description,
        archived: project.archivedAt !== null,
        createdAt: project.createdAt.toISOString(),
        taskCount: totals.get(project.id) ?? 0,
        folders: folderRows
          .filter((folder) => folder.projectId === project.id)
          .map((folder) => ({
            id: folder.id,
            projectId: folder.projectId,
            name: folder.name,
            position: folder.position,
            archived: folder.archivedAt !== null,
          })),
        lists: listRows
          .filter((list) => list.projectId === project.id)
          .map((list) => ({
            id: list.id,
            projectId: list.projectId,
            folderId: list.folderId,
            name: list.name,
            position: list.position,
            archived: list.archivedAt !== null,
          })),
      })),
    });
  });

  app.post('/api/projects', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'project.create'))) return;
    if (!(await withinLimit(request, reply, session, 'projects'))) return;

    const parsed = projectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the project.', fieldErrors(parsed.error)));
    }

    const taken = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, session.organization.id), eq(projects.key, parsed.data.key)))
      .limit(1);

    if (taken.length > 0) {
      return reply.code(409).send(fail('invalid_request', 'That key is taken.', { key: 'That key is taken.' }));
    }

    const created = await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          organizationId: session.organization.id,
          name: parsed.data.name,
          key: parsed.data.key,
          description: parsed.data.description ?? null,
          createdBy: session.user.id,
        })
        .returning();

      if (!project) return null;

      // A project with no list has nowhere to put a task, so it gets one.
      const [list] = await tx
        .insert(lists)
        .values({ projectId: project.id, name: 'Tasks', position: 0 })
        .returning();

      return { project, list };
    });

    if (!created?.project) return reply.code(500).send(fail('server_error', 'The project was not written.'));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'project.create',
      resource: String(parsed.data.name),
    });

    return reply.code(201).send({
      id: created.project.id,
      name: created.project.name,
      key: created.project.key,
      description: created.project.description,
      archived: false,
      createdAt: created.project.createdAt.toISOString(),
      taskCount: 0,
      folders: [],
      lists: created.list
        ? [
            {
              id: created.list.id,
              projectId: created.project.id,
              folderId: null,
              name: created.list.name,
              position: 0,
              archived: false,
            },
          ]
        : [],
    });
  });

  app.post('/api/folders', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'project.create'))) return;

    const parsed = folderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the folder.', fieldErrors(parsed.error)));
    }

    if (!(await ownsProject(session.organization.id, parsed.data.projectId))) {
      return reply.code(404).send(fail('not_found', 'That project is gone.'));
    }

    const [row] = await db
      .insert(folders)
      .values({ projectId: parsed.data.projectId, name: parsed.data.name })
      .returning();

    if (!row) return reply.code(500).send(fail('server_error', 'The folder was not written.'));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'folder.create',
      resource: String(parsed.data.name),
    });

    return reply.code(201).send({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      position: row.position,
      archived: false,
    });
  });

  app.post('/api/lists', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'project.create'))) return;

    const parsed = listSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the list.', fieldErrors(parsed.error)));
    }

    if (!(await ownsProject(session.organization.id, parsed.data.projectId))) {
      return reply.code(404).send(fail('not_found', 'That project is gone.'));
    }

    const [row] = await db
      .insert(lists)
      .values({
        projectId: parsed.data.projectId,
        folderId: parsed.data.folderId ?? null,
        name: parsed.data.name,
      })
      .returning();

    if (!row) return reply.code(500).send(fail('server_error', 'The list was not written.'));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'list.create',
      resource: String(parsed.data.name),
    });

    return reply.code(201).send({
      id: row.id,
      projectId: row.projectId,
      folderId: row.folderId,
      name: row.name,
      position: row.position,
      archived: false,
    });
  });

  /* --------------------------------------------------------------- tasks -- */

  app.get('/api/tasks', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const query = request.query as {
      status?: string;
      assigneeId?: string;
      priority?: string;
      archived?: string;
    };

    const filters = [eq(tasks.organizationId, session.organization.id)];

    // Each filter accepts a comma separated list, so a person can hold two
    // statuses at once without the rule itself becoming ambiguous.
    const statuses = (query.status ?? '').split(',').filter(Boolean);
    if (statuses.length > 0) filters.push(inArray(tasks.status, statuses as TaskStatus[]));

    const priorities = (query.priority ?? '').split(',').filter(Boolean);
    if (priorities.length > 0) filters.push(inArray(tasks.priority, priorities as TaskPriority[]));

    if (query.assigneeId === 'none') filters.push(isNull(tasks.assigneeId));
    else if (query.assigneeId) filters.push(eq(tasks.assigneeId, query.assigneeId));

    /*
       Three modes rather than two.

       The default hides the archive. "only" is the archive folder, and it must
       exclude live tasks or the folder would list everything.
    */
    if (query.archived === 'only') filters.push(isNotNull(tasks.archivedAt));
    else if (query.archived !== 'true') filters.push(isNull(tasks.archivedAt));

    const prefix = await prefixFor(session.organization.id);

    const rows = await db
      .select({
        task: tasks,
        assigneeId: users.id,
        assigneeName: users.fullName,
        assigneeEmail: users.email,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(...filters))
      .orderBy(asc(tasks.position), desc(tasks.createdAt));

    const activityCounts = await loadTaskActivityCounts(rows.map((row) => row.task.id));

    return reply.send({
      tasks: rows.map((row) =>
        shapeTask(
          row.task,
          prefix,
          row.assigneeId
            ? { id: row.assigneeId, fullName: row.assigneeName ?? '', email: row.assigneeEmail ?? '' }
            : null,
          activityCounts.get(row.task.id) ?? { subtasks: 0, comments: 0, attachments: 0 },
          [],
        ),
      ),
    });
  });

  app.post('/api/tasks', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;
    if (!(await needsPlan(request, reply, session, 'pro', 'Tasks'))) return;

    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the task.', fieldErrors(parsed.error)));
    }

    // A list is optional. When one is named, it must belong to this workspace.
    let listId: string | null = null;
    let projectId: string | null = null;

    if (parsed.data.listId) {
      const [list] = await db
        .select({ id: lists.id, projectId: lists.projectId })
        .from(lists)
        .innerJoin(projects, eq(projects.id, lists.projectId))
        .where(and(eq(lists.id, parsed.data.listId), eq(projects.organizationId, session.organization.id)))
        .limit(1);

      if (!list) return reply.code(404).send(fail('not_found', 'That list is gone.'));
      listId = list.id;
      projectId = list.projectId;
    }

    // A subtask never has its own subtasks, so a parent must be top level.
    if (parsed.data.parentId) {
      const [parent] = await db
        .select({ parentId: tasks.parentId })
        .from(tasks)
        .where(and(eq(tasks.id, parsed.data.parentId), eq(tasks.organizationId, session.organization.id)))
        .limit(1);

      if (!parent) return reply.code(404).send(fail('not_found', 'That parent task is gone.'));
      if (parent.parentId) {
        return reply.code(400).send(fail('invalid_request', 'A subtask cannot hold another subtask.'));
      }
    }

    const created = await db.transaction(async (tx) => {
      // Bump and read the workspace counter in one statement, so two writers
      // cannot take the same number.
      const [org] = await tx
        .update(organizations)
        .set({ nextTaskNumber: raw`${organizations.nextTaskNumber} + 1` })
        .where(eq(organizations.id, session.organization.id))
        .returning({ number: organizations.nextTaskNumber, prefix: organizations.taskPrefix });

      if (!org) return null;

      const [row] = await tx
        .insert(tasks)
        .values({
          organizationId: session.organization.id,
          projectId,
          listId,
          number: org.number - 1,
          parentId: parsed.data.parentId ?? null,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          status: parsed.data.status ?? 'backlogs',
          priority: parsed.data.priority ?? 'normal',
          assigneeId: parsed.data.assigneeId ?? null,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
          linkedIssueId: parsed.data.linkedIssueId ?? null,
          createdBy: session.user.id,
        })
        .returning();

      return row ? { row, prefix: org.prefix } : null;
    });

    if (!created) return reply.code(500).send(fail('server_error', 'The task was not written.'));

    await record(created.row.id, session.user.id, 'created', null, null);

    // Only the assignee hears, and never about their own doing.
    if (created.row.assigneeId && created.row.assigneeId !== session.user.id) {
      notifyLater(
        {
          organizationId: session.organization.id,
          userId: created.row.assigneeId,
          source: 'task',
          title: `${session.user.fullName} assigned you ${created.prefix}-${created.row.number}`,
          body: created.row.title,
          href: '/tasks',
        },
        request.log,
      );
    }

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'task.create',
      resource: String(parsed.data.title),
    });

    return reply
      .code(201)
      .send(shapeTask(created.row, created.prefix, null, { subtasks: 0, comments: 0, attachments: 0 }, []));
  });

  app.patch('/api/tasks/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the task.', fieldErrors(parsed.error)));
    }

    const [before] = await db
      .select({ task: tasks })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .limit(1);

    if (!before) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    const data = parsed.data;
    const [row] = await db
      .update(tasks)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
        ...(data.listId !== undefined ? { listId: data.listId } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate ? new Date(data.startDate) : null } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        ...(data.remindAt !== undefined ? { remindAt: data.remindAt ? new Date(data.remindAt) : null } : {}),
        ...(data.linkedIssueId !== undefined ? { linkedIssueId: data.linkedIssueId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .returning();

    if (!row) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    if (data.status !== undefined && data.status !== before.task.status) {
      await record(id, session.user.id, 'status', before.task.status, data.status);
    }
    if (data.priority !== undefined && data.priority !== before.task.priority) {
      await record(id, session.user.id, 'priority', before.task.priority, data.priority);
    }
    if (data.assigneeId !== undefined && data.assigneeId !== before.task.assigneeId) {
      await record(id, session.user.id, 'assignee', before.task.assigneeId, data.assigneeId);
    }

    const prefix = await prefixFor(session.organization.id);
    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'task.update',
      resource: String('Task ' + id),
    });

    return reply.send(shapeTask(row, prefix, null, { subtasks: 0, comments: 0, attachments: 0 }, []));
  });

  /** Archiving keeps the history. Nothing here deletes a task outright. */
  app.post('/api/tasks/:id/archive', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { archived?: boolean };
    const archiving = body.archived !== false;

    const [row] = await db
      .update(tasks)
      .set({ archivedAt: archiving ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .returning({ id: tasks.id, title: tasks.title });

    if (!row) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    await record(id, session.user.id, archiving ? 'archived' : 'restored', null, null);
    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: archiving ? 'task.archive' : 'task.restore',
      resource: row.title,
    });

    return reply.code(204).send();
  });

  /**
   * Deletes a task for good.
   *
   * Only an archived task can go. Archiving is the reversible step, and making
   * somebody archive first means nothing is destroyed by one stray click.
   */
  app.delete('/api/tasks/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };

    const [doomed] = await db
      .select({ title: tasks.title, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .limit(1);

    if (!doomed) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    if (doomed.archivedAt === null) {
      return reply.code(400).send(fail('invalid_request', 'Archive the task before you delete it.'));
    }

    await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'task.delete',
      resource: doomed.title,
    });

    return reply.code(204).send();
  });

  /** The full task, with its timeline. */
  app.get('/api/tasks/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const { id } = request.params as { id: string };

    const [row] = await db
      .select({
        task: tasks,
        assigneeId: users.id,
        assigneeName: users.fullName,
        assigneeEmail: users.email,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .limit(1);

    if (!row) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    const checklist = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.taskId, id))
      .orderBy(asc(checklistItems.position));

    const [subs] = await db.select({ total: count() }).from(tasks).where(eq(tasks.parentId, id));

    const commentRows = await db
      .select({
        comment: taskComments,
        authorId: users.id,
        authorName: users.fullName,
        authorEmail: users.email,
      })
      .from(taskComments)
      .leftJoin(users, eq(users.id, taskComments.authorId))
      .where(eq(taskComments.taskId, id));

    const eventRows = await db
      .select({
        activity: taskActivity,
        actorId: users.id,
        actorName: users.fullName,
        actorEmail: users.email,
      })
      .from(taskActivity)
      .leftJoin(users, eq(users.id, taskActivity.actorId))
      .where(eq(taskActivity.taskId, id));

    const files = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, id));
    const taskFiles = files.filter((file) => file.commentId === null).map((file) => shapeAttachment(file));

    // Comments and events share one stream, so the task reads top to bottom.
    const timeline: TimelineEntry[] = [
      ...commentRows.map((entry) => ({
        kind: 'comment' as const,
        id: entry.comment.id,
        author: entry.authorId
          ? { id: entry.authorId, fullName: entry.authorName ?? '', email: entry.authorEmail ?? '' }
          : null,
        body: entry.comment.body,
        attachments: files
          .filter((file) => file.commentId === entry.comment.id)
          .map((file) => ({
            ...shapeAttachment(file),
          })),
        createdAt: entry.comment.createdAt.toISOString(),
        editedAt: entry.comment.editedAt?.toISOString() ?? null,
      })),
      ...eventRows.map((entry) => ({
        kind: 'event' as const,
        id: entry.activity.id,
        actor: entry.actorId
          ? { id: entry.actorId, fullName: entry.actorName ?? '', email: entry.actorEmail ?? '' }
          : null,
        event: entry.activity.event as TaskEvent,
        from: entry.activity.fromValue,
        to: entry.activity.toValue,
        createdAt: entry.activity.createdAt.toISOString(),
      })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const task = shapeTask(
      row.task,
      await prefixFor(session.organization.id),
      row.assigneeId
        ? { id: row.assigneeId, fullName: row.assigneeName ?? '', email: row.assigneeEmail ?? '' }
        : null,
      { subtasks: Number(subs?.total ?? 0), comments: commentRows.length, attachments: files.length },
      checklist.map((item) => ({ id: item.id, text: item.text, done: item.done, position: item.position })),
    );

    return reply.send({ task, timeline, attachments: taskFiles });
  });

  app.post('/api/tasks/:id/attachments', { bodyLimit: TASK_ATTACHMENT_MAX_BYTES }, async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    const query = request.query as { commentId?: string };
    const body = request.body;
    const mimeType = String(request.headers['content-type'] ?? '').split(';')[0]?.trim() || 'application/octet-stream';

    if (!Buffer.isBuffer(body)) {
      return reply.code(400).send(fail('invalid_request', 'Choose a file to upload.'));
    }
    if (!allowedAttachmentTypes.has(mimeType)) {
      return reply.code(415).send(fail('invalid_request', 'Cerberus cannot read that file type.'));
    }
    if (body.length === 0) {
      return reply.code(400).send(fail('invalid_request', 'Choose a file that is not empty.'));
    }

    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .limit(1);

    if (!task) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    if (query.commentId) {
      const [comment] = await db
        .select({ id: taskComments.id })
        .from(taskComments)
        .where(and(eq(taskComments.id, query.commentId), eq(taskComments.taskId, id)))
        .limit(1);
      if (!comment) return reply.code(404).send(fail('not_found', 'That comment is gone.'));
    }

    const [file] = await db
      .insert(taskAttachments)
      .values({
        taskId: id,
        commentId: query.commentId ?? null,
        name: attachmentName(request),
        mimeType,
        size: body.length,
        data: body,
        uploadedBy: session.user.id,
      })
      .returning();

    if (!file) return reply.code(500).send(fail('server_error', 'The file was not uploaded.'));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'task.attach',
      resource: String('Task ' + id),
    });

    return reply.code(201).send(shapeAttachment(file, {
      id: session.user.id,
      fullName: session.user.fullName,
      email: session.user.email,
    }));
  });

  app.get('/api/tasks/:id/attachments/:attachmentId', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const [file] = await db
      .select({ attachment: taskAttachments })
      .from(taskAttachments)
      .innerJoin(tasks, eq(tasks.id, taskAttachments.taskId))
      .where(and(
        eq(taskAttachments.id, attachmentId),
        eq(taskAttachments.taskId, id),
        eq(tasks.organizationId, session.organization.id),
      ))
      .limit(1);

    if (!file) return reply.code(404).send(fail('not_found', 'That file is gone.'));

    return reply
      .header('content-type', file.attachment.mimeType)
      .header('content-length', String(file.attachment.size))
      .header('content-disposition', contentDisposition(file.attachment.name))
      .send(Buffer.from(file.attachment.data));
  });

  app.post('/api/tasks/:id/comments', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = z
      .object({ body: z.string().trim().min(1, 'Write something first.').max(20000) })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the comment.', fieldErrors(parsed.error)));
    }

    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.organization.id)))
      .limit(1);

    if (!task) return reply.code(404).send(fail('not_found', 'That task is gone.'));

    const [row] = await db
      .insert(taskComments)
      .values({ taskId: id, authorId: session.user.id, body: parsed.data.body })
      .returning();

    if (!row) return reply.code(500).send(fail('server_error', 'The comment was not written.'));

    auditRecord(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'task.comment',
      resource: String('Task ' + id),
    });

    return reply.code(201).send({
      kind: 'comment',
      id: row.id,
      author: { id: session.user.id, fullName: session.user.fullName, email: session.user.email },
      body: row.body,
      attachments: [],
      createdAt: row.createdAt.toISOString(),
      editedAt: null,
    });
  });
}

/** The prefix every task ref in this workspace carries. */
async function prefixFor(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ prefix: organizations.taskPrefix })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.prefix ?? 'TSK';
}

async function ownsProject(organizationId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}
