import { and, asc, desc, eq, gte, sql as raw, avg } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { monitors, heartbeats } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record, recordDenied } from '../audit/record.js';
import { fail, fieldErrors } from '../http/errors.js';
import { needsPlan, withinLimit } from '../http/plan.js';
import { notify } from '../schedules/deliver.js';
import type { SessionPayload } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';
import type {
  Monitor,
  MonitorSummary,
  Heartbeat,
  SaveMonitorRequest,
} from '../../../shared/argus.js';
import { HTTP_METHODS, BODY_ENCODINGS } from '../../../shared/argus.js';

/**
 * Argus.
 *
 * CRUD for monitors and heartbeat history. The prober runs separately and
 * writes heartbeats. These routes only read and write monitor config.
 */

const monitorSchema = z.object({
  name: z.string().trim().min(1, 'Name the monitor.').max(120),
  url: z.string().trim().url('Enter a valid URL.').max(2000),
  method: z.enum(HTTP_METHODS).default('GET'),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  body: z.string().max(10000).nullable().optional(),
  bodyEncoding: z.enum(BODY_ENCODINGS).default('json'),
  expectedStatusCodes: z.array(z.number().int().min(100).max(599)).min(1).max(20).optional(),
  intervalSeconds: z.number().int().min(10).max(86400).default(60),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
  retries: z.number().int().min(0).max(10).default(3),
  retryIntervalSeconds: z.number().int().min(5).max(3600).default(60),
  monitorGroup: z.string().trim().max(80).nullable().optional(),
  certExpiryCheck: z.boolean().default(true),
  upsideDownMode: z.boolean().default(false),
  maxRedirects: z.number().int().min(0).max(50).default(10),
  active: z.boolean().default(true),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
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

async function allow(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionPayload,
  permission: Permission,
): Promise<boolean> {
  const context = {
    role: session.role,
    kind: session.organization.kind,
    policy: session.organization.policy,
  };

  if (can(permission, context)) return true;

  // A refusal is the row an auditor most wants, so it is written too.
  recordDenied(request, {
    organizationId: session.organization.id,
    actorUserId: session.user.id,
    actor: session.user.email,
    action: 'permission.denied',
    resource: permission,
  });

  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

function toMonitor(row: typeof monitors.$inferSelect): Monitor {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    headers: (row.headers as Record<string, string>) ?? null,
    body: row.body,
    bodyEncoding: row.bodyEncoding,
    expectedStatusCodes: (row.expectedStatusCodes as number[]) ?? [200, 201, 202, 203, 204, 205, 206, 207, 208, 226],
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    retries: row.retries,
    retryIntervalSeconds: row.retryIntervalSeconds,
    monitorGroup: row.monitorGroup,
    certExpiryCheck: row.certExpiryCheck,
    upsideDownMode: row.upsideDownMode,
    maxRedirects: row.maxRedirects,
    active: row.active,
    tags: (row.tags as string[]) ?? [],
    contactPointId: row.contactPointId,
    currentStatus: row.currentStatus as Monitor['currentStatus'],
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    checkCount: row.checkCount,
    upCount: row.upCount,
    consecutiveDown: row.consecutiveDown,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHeartbeat(row: typeof heartbeats.$inferSelect): Heartbeat {
  return {
    id: row.id,
    monitorId: row.monitorId,
    status: row.status as Heartbeat['status'],
    responseTimeMs: row.responseTimeMs,
    statusCode: row.statusCode,
    errorMessage: row.errorMessage,
    certExpiryDays: row.certExpiryDays,
    checkedAt: row.checkedAt.toISOString(),
  };
}

export default async function argusRoutes(app: FastifyInstance) {
  /* ----------------------------------------------------------- monitors -- */

  app.get('/api/argus/monitors', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const rows = await db
      .select()
      .from(monitors)
      .where(eq(monitors.organizationId, session.organization.id))
      .orderBy(asc(monitors.monitorGroup), asc(monitors.name));

    // Compute uptime and avg response for each monitor.
    const summaries: MonitorSummary[] = [];

    for (const row of rows) {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const uptime24hResult = await db
        .select({
          up: raw<number>`count(*) filter (where ${heartbeats.status} = 'up')`,
          total: raw<number>`count(*)`,
        })
        .from(heartbeats)
        .where(and(eq(heartbeats.monitorId, row.id), gte(heartbeats.checkedAt, dayAgo)));

      const uptime30dResult = await db
        .select({
          up: raw<number>`count(*) filter (where ${heartbeats.status} = 'up')`,
          total: raw<number>`count(*)`,
        })
        .from(heartbeats)
        .where(and(eq(heartbeats.monitorId, row.id), gte(heartbeats.checkedAt, thirtyAgo)));

      const avgResult = await db
        .select({ avg: avg(heartbeats.responseTimeMs) })
        .from(heartbeats)
        .where(
          and(
            eq(heartbeats.monitorId, row.id),
            gte(heartbeats.checkedAt, dayAgo),
            raw`${heartbeats.responseTimeMs} is not null`,
          ),
        );

      const certRow = await db
        .select({ days: heartbeats.certExpiryDays })
        .from(heartbeats)
        .where(
          and(
            eq(heartbeats.monitorId, row.id),
            raw`${heartbeats.certExpiryDays} is not null`,
            gte(heartbeats.checkedAt, dayAgo),
          ),
        )
        .orderBy(desc(heartbeats.checkedAt))
        .limit(1);

      const uptime24h = uptime24hResult[0];
      const uptime30d = uptime30dResult[0];
      const avgResp = avgResult[0];

      summaries.push({
        ...toMonitor(row),
        uptime24h: uptime24h && uptime24h.total > 0 ? Math.round((uptime24h.up / uptime24h.total) * 10000) / 100 : null,
        uptime30d: uptime30d && uptime30d.total > 0 ? Math.round((uptime30d.up / uptime30d.total) * 10000) / 100 : null,
        avgResponseMs: avgResp?.avg ? Math.round(Number(avgResp.avg)) : null,
        certExpiryDays: certRow[0]?.days ?? null,
      });
    }

    return reply.send({ monitors: summaries });
  });

  app.get('/api/argus/monitors/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const { id } = request.params as { id: string };
    const [row] = await db
      .select()
      .from(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .limit(1);

    if (!row) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    return reply.send({ monitor: toMonitor(row) });
  });

  app.post('/api/argus/monitors', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;
    if (!(await needsPlan(request, reply, session, 'pro', 'Uptime'))) return;
    if (!(await withinLimit(request, reply, session, 'monitors'))) return;

    const parsed = monitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the monitor.', fieldErrors(parsed.error)));
    }

    const d = parsed.data;
    const now = new Date();

    const rows = await db
      .insert(monitors)
      .values({
        organizationId: session.organization.id,
        name: d.name,
        url: d.url,
        method: d.method,
        headers: d.headers ?? null,
        body: d.body ?? null,
        bodyEncoding: d.bodyEncoding,
        expectedStatusCodes: d.expectedStatusCodes,
        intervalSeconds: d.intervalSeconds,
        timeoutSeconds: d.timeoutSeconds,
        retries: d.retries,
        retryIntervalSeconds: d.retryIntervalSeconds,
        monitorGroup: d.monitorGroup ?? null,
        certExpiryCheck: d.certExpiryCheck,
        upsideDownMode: d.upsideDownMode,
        maxRedirects: d.maxRedirects,
        active: d.active,
        tags: d.tags,
        contactPointId: d.contactPointId ?? null,
        currentStatus: 'pending',
        nextCheckAt: now,
        createdBy: session.user.id,
      })
      .returning();

    const row = rows[0];
    if (!row) return reply.code(500).send(fail('server_error', 'The monitor was not written.'));

    await notify({
      organizationId: session.organization.id,
      source: 'alert',
      title: `Monitor created: ${d.name}`,
      body: `Watching ${d.url} every ${d.intervalSeconds}s.`,
      href: '/argus',
    });

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.create',
      resource: String(parsed.data.name),
    });

    return reply.code(201).send(toMonitor(row));
  });

  app.patch('/api/argus/monitors/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = monitorSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the monitor.', fieldErrors(parsed.error)));
    }

    const d = parsed.data;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (d.name !== undefined) update.name = d.name;
    if (d.url !== undefined) update.url = d.url;
    if (d.method !== undefined) update.method = d.method;
    if (d.headers !== undefined) update.headers = d.headers ?? null;
    if (d.body !== undefined) update.body = d.body ?? null;
    if (d.bodyEncoding !== undefined) update.bodyEncoding = d.bodyEncoding;
    if (d.expectedStatusCodes !== undefined) update.expectedStatusCodes = d.expectedStatusCodes;
    if (d.intervalSeconds !== undefined) update.intervalSeconds = d.intervalSeconds;
    if (d.timeoutSeconds !== undefined) update.timeoutSeconds = d.timeoutSeconds;
    if (d.retries !== undefined) update.retries = d.retries;
    if (d.retryIntervalSeconds !== undefined) update.retryIntervalSeconds = d.retryIntervalSeconds;
    if (d.monitorGroup !== undefined) update.monitorGroup = d.monitorGroup ?? null;
    if (d.certExpiryCheck !== undefined) update.certExpiryCheck = d.certExpiryCheck;
    if (d.upsideDownMode !== undefined) update.upsideDownMode = d.upsideDownMode;
    if (d.maxRedirects !== undefined) update.maxRedirects = d.maxRedirects;
    if (d.active !== undefined) update.active = d.active;
    if (d.tags !== undefined) update.tags = d.tags;
    if (d.contactPointId !== undefined) update.contactPointId = d.contactPointId ?? null;

    const rows = await db
      .update(monitors)
      .set(update)
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    await notify({
      organizationId: session.organization.id,
      source: 'alert',
      title: `Monitor updated: ${toMonitor(row).name}`,
      body: `Configuration changed.`,
      href: '/argus',
    });

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.update',
      resource: row.name,
    });

    return reply.send(toMonitor(row));
  });

  app.delete('/api/argus/monitors/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };

    const [doomed] = await db
      .select({ name: monitors.name })
      .from(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .limit(1);

    await db
      .delete(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)));

    if (doomed) {
      await notify({
        organizationId: session.organization.id,
        source: 'alert',
        title: `Monitor deleted: ${doomed.name}`,
        body: 'The monitor and its history were removed.',
        href: '/argus',
      });
    }

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.delete',
      resource: doomed?.name ?? id,
    });

    return reply.code(204).send();
  });

  /* --------------------------------------------------------- heartbeats -- */

  app.get('/api/argus/monitors/:id/heartbeats', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'workspace.view'))) return;

    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; since?: string };

    /*
       The monitor must belong to this workspace.

       Without this the route filtered on the monitor id alone, so anybody
       signed in anywhere could read any workspace's uptime history by knowing
       a uuid. A join through the monitor is the only thing that scopes a
       heartbeat, because the heartbeat row carries no organization of its own.
    */
    const [owned] = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .limit(1);

    if (!owned) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    const limit = Math.min(Math.max(parseInt(query.limit ?? '100', 10) || 100, 1), 1000);

    let where = and(eq(heartbeats.monitorId, id));

    if (query.since) {
      const since = new Date(query.since);
      if (!isNaN(since.getTime())) {
        where = and(where, gte(heartbeats.checkedAt, since));
      }
    }

    const rows = await db
      .select()
      .from(heartbeats)
      .where(where)
      .orderBy(desc(heartbeats.checkedAt))
      .limit(limit);

    return reply.send({ heartbeats: rows.map(toHeartbeat) });
  });

  /* ------------------------------------------------- bulk actions -- */

  app.post('/api/argus/monitors/:id/pause', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const rows = await db
      .update(monitors)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.pause',
      resource: row.name,
    });

    return reply.send(toMonitor(row));
  });

  app.post('/api/argus/monitors/:id/resume', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const rows = await db
      .update(monitors)
      .set({ active: true, nextCheckAt: new Date(), updatedAt: new Date() })
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.resume',
      resource: row.name,
    });

    return reply.send(toMonitor(row));
  });

  /* ---------------------------------------------------------- reset -- */

  app.post('/api/argus/monitors/:id/reset', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(request, reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const rows = await db
      .update(monitors)
      .set({ checkCount: 0, upCount: 0, consecutiveDown: 0, updatedAt: new Date() })
      .where(and(eq(monitors.id, id), eq(monitors.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That monitor is gone.'));

    await notify({
      organizationId: session.organization.id,
      source: 'alert',
      title: `Monitor reset: ${toMonitor(row).name}`,
      body: 'Check count and uptime stats were reset to zero.',
      href: '/argus',
    });

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'monitor.reset',
      resource: row.name,
    });

    return reply.send(toMonitor(row));
  });
}
