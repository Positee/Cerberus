import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { organizations, scheduleRuns, schedules, tasks } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';
import { PRIORITY_ORDER, STATUS_ORDER, type TaskPriority, type TaskStatus } from '../../../shared/tasks.js';
import { nextRun, type Recurrence, type Schedule } from '../../../shared/schedules.js';
import { runDue } from './runner.js';

/** Schedules. The runner does the firing. These routes only describe them. */

const recurrenceSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  dayOfMonth: z.number().int().min(1).max(31),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 09:00.'),
});

const scheduleSchema = z.object({
  name: z.string().trim().min(1, 'Name the schedule.').max(120),
  kind: z.enum(['reminder', 'task', 'report', 'scan']),
  enabled: z.boolean(),
  recurrence: recurrenceSchema,
  payload: z.record(z.string(), z.unknown()),
  /** Null means the bell only. */
  contactPointId: z.string().uuid().nullable().optional(),
});

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionPayload | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return null;
  }
  return session;
}

async function allow(reply: FastifyReply, session: SessionPayload, permission: Permission): Promise<boolean> {
  const context = { role: session.role, kind: session.organization.kind, policy: session.organization.policy };
  if (can(permission, context)) return true;
  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

/** Each kind must carry enough to do its job. */
function checkPayload(kind: string, payload: Record<string, unknown>): string | null {
  if (kind === 'reminder') {
    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    return note ? null : 'Say what the reminder should tell you.';
  }

  if (kind !== 'task') return null;

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title) return 'Give the task a title.';

  const status = payload.status;
  if (status !== undefined && !STATUS_ORDER.includes(status as TaskStatus)) return 'That status does not exist.';

  const priority = payload.priority;
  if (priority !== undefined && !PRIORITY_ORDER.includes(priority as TaskPriority)) {
    return 'That priority does not exist.';
  }
  return null;
}

function shape(
  row: typeof schedules.$inferSelect,
  runs: Array<typeof scheduleRuns.$inferSelect & { taskNumber: number | null }>,
  prefix: string,
): Schedule {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Schedule['kind'],
    enabled: row.enabled,
    recurrence: row.recurrence as Recurrence,
    payload: row.payload as Schedule['payload'],
    contactPointId: row.contactPointId,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    runCount: row.runCount,
    createdAt: row.createdAt.toISOString(),
    recentRuns: runs
      .filter((run) => run.scheduleId === row.id)
      .map((run) => ({
        id: run.id,
        ranAt: run.ranAt.toISOString(),
        outcome: run.outcome as 'ok' | 'failed' | 'skipped',
        note: run.note,
        createdTaskRef: run.taskNumber === null ? null : `${prefix}-${run.taskNumber}`,
      })),
  };
}

export default async function scheduleRoutes(app: FastifyInstance) {
  app.get('/api/schedules', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.organizationId, session.organization.id))
      .orderBy(asc(schedules.nextRunAt));

    const ids = rows.map((row) => row.id);

    const runs = ids.length
      ? await db
          .select({
            id: scheduleRuns.id,
            scheduleId: scheduleRuns.scheduleId,
            ranAt: scheduleRuns.ranAt,
            outcome: scheduleRuns.outcome,
            note: scheduleRuns.note,
            createdTaskId: scheduleRuns.createdTaskId,
            taskNumber: tasks.number,
          })
          .from(scheduleRuns)
          .leftJoin(tasks, eq(tasks.id, scheduleRuns.createdTaskId))
          .where(inArray(scheduleRuns.scheduleId, ids))
          .orderBy(desc(scheduleRuns.ranAt))
          .limit(200)
      : [];

    const [org] = await db
      .select({ prefix: organizations.taskPrefix })
      .from(organizations)
      .where(eq(organizations.id, session.organization.id))
      .limit(1);

    return reply.send({
      schedules: rows.map((row) =>
        shape(row, runs as Parameters<typeof shape>[1], org?.prefix ?? 'TSK'),
      ),
    });
  });

  app.post('/api/schedules', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'task.manage'))) return;

    const parsed = scheduleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the schedule.', fieldErrors(parsed.error)));
    }

    const problem = checkPayload(parsed.data.kind, parsed.data.payload);
    if (problem) {
      const field = parsed.data.kind === 'reminder' ? 'payload.note' : 'payload.title';
      return reply.code(400).send(fail('invalid_request', problem, { [field]: problem }));
    }

    const [row] = await db
      .insert(schedules)
      .values({
        organizationId: session.organization.id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        enabled: parsed.data.enabled,
        recurrence: parsed.data.recurrence,
        payload: parsed.data.payload,
        contactPointId: parsed.data.contactPointId ?? null,
        // Worked out here, so the runner only has to compare timestamps.
        nextRunAt: parsed.data.enabled ? nextRun(parsed.data.recurrence, new Date()) : null,
        createdBy: session.user.id,
      })
      .returning();

    if (!row) return reply.code(500).send(fail('server_error', 'The schedule was not written.'));

    return reply.code(201).send(shape(row, [], 'TSK'));
  });

  app.patch('/api/schedules/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = scheduleSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the schedule.', fieldErrors(parsed.error)));
    }

    const [before] = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, session.organization.id)))
      .limit(1);

    if (!before) return reply.code(404).send(fail('not_found', 'That schedule is gone.'));

    const data = parsed.data;
    const recurrence = (data.recurrence ?? before.recurrence) as Recurrence;
    const enabled = data.enabled ?? before.enabled;

    // An edit has to clear the same bar as a create, or a saved schedule could
    // lose the task title it needs to fire.
    if (data.payload !== undefined || data.kind !== undefined) {
      const kind = data.kind ?? before.kind;
      const payload = (data.payload ?? before.payload) as Record<string, unknown>;
      const problem = checkPayload(kind, payload);
      if (problem) {
        return reply.code(400).send(fail('invalid_request', problem, { 'payload.title': problem }));
      }
    }

    /*
       The next run only moves when something about the timing moves.

       Recomputing on every patch would mean renaming a schedule due in five
       minutes silently pushed it to its next occurrence. So: turning it off
       clears the time, turning it on works out a fresh one, a changed
       recurrence works out a fresh one, and anything else leaves it alone.
    */
    const timingChanged =
      data.recurrence !== undefined && JSON.stringify(recurrence) !== JSON.stringify(before.recurrence);
    const wokeUp = enabled && !before.enabled;

    let nextAt = before.nextRunAt;
    if (!enabled) nextAt = null;
    else if (timingChanged || wokeUp || nextAt === null) nextAt = nextRun(recurrence, new Date());

    const [row] = await db
      .update(schedules)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.payload !== undefined ? { payload: data.payload } : {}),
        ...(data.contactPointId !== undefined ? { contactPointId: data.contactPointId } : {}),
        recurrence,
        enabled,
        nextRunAt: nextAt,
        updatedAt: new Date(),
      })
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, session.organization.id)))
      .returning();

    if (!row) return reply.code(404).send(fail('not_found', 'That schedule is gone.'));

    return reply.send(shape(row, [], 'TSK'));
  });

  app.delete('/api/schedules/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };
    await db
      .delete(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, session.organization.id)));

    return reply.code(204).send();
  });

  /** Fires one schedule now, without waiting for its time. */
  app.post('/api/schedules/:id/run', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'task.manage'))) return;

    const { id } = request.params as { id: string };

    const [row] = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.organizationId, session.organization.id)))
      .limit(1);

    if (!row) return reply.code(404).send(fail('not_found', 'That schedule is gone.'));

    // Pulling the time back makes it due, then the ordinary runner handles it.
    await db.update(schedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schedules.id, id));
    await runDue(app.log);

    return reply.code(202).send({ ran: true });
  });
}
