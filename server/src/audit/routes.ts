import { and, count, desc, eq, gte, ilike, lt, sql as raw } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record } from './record.js';
import { notifyLater } from '../notifications/notify.js';
import { buildPdf } from './pdf.js';
import { fail } from '../http/errors.js';
import { LIMITS } from '../../../shared/plans.js';
import {
  ACTION_LABEL,
  describeFilter,
  EXPORT_CAP,
  PAGE_SIZE,
  type AuditAction,
  type AuditCategory,
  type AuditEvent,
  type AuditFilter,
} from '../../../shared/audit.js';

/**
 * Reading the audit trail.
 *
 * Nothing here writes. Rows come from record.ts, which every other route calls.
 * The list and both exports share one filter, so a downloaded report always
 * holds exactly the rows a person saw.
 */


/** The action prefixes each category covers. */
const CATEGORY_PREFIX: Record<AuditCategory, string[]> = {
  access: ['auth.'],
  account: ['profile.', 'account.'],
  workspace: ['workspace.', 'member.', 'invitation.'],
  alerting: ['alert.', 'contact.', 'notification.'],
  work: ['project.', 'task.', 'schedule.'],
  uptime: ['monitor.'],
};

function readFilter(request: FastifyRequest): AuditFilter {
  const query = request.query as Record<string, string | undefined>;
  const filter: AuditFilter = {};

  if (query.result === 'allowed' || query.result === 'denied') filter.result = query.result;
  if (query.category && query.category in CATEGORY_PREFIX) filter.category = query.category as AuditCategory;
  if (query.actor?.trim()) filter.actor = query.actor.trim();
  if (query.from?.trim()) filter.from = query.from.trim();
  if (query.to?.trim()) filter.to = query.to.trim();

  return filter;
}

/**
 * Builds the where clause.
 *
 * The plan decides how far back a workspace may look, so a Free workspace
 * cannot read past its seven days by asking for an older date.
 */
function conditions(organizationId: string, filter: AuditFilter, historyDays: number | null) {
  const parts = [eq(auditEvents.organizationId, organizationId)];

  if (filter.result) parts.push(eq(auditEvents.result, filter.result));

  if (filter.category) {
    const prefixes = CATEGORY_PREFIX[filter.category];
    parts.push(raw`(${raw.join(
      prefixes.map((prefix) => raw`${auditEvents.action} like ${prefix + '%'}`),
      raw` or `,
    )})`);
  }

  if (filter.actor) parts.push(ilike(auditEvents.actorLabel, `%${filter.actor}%`));

  // A date that does not parse is ignored rather than passed on. Reaching the
  // query with an Invalid Date threw, and the caller saw a 500 for their own
  // bad input.
  const from = filter.from ? new Date(filter.from) : null;
  if (from && !Number.isNaN(from.getTime())) parts.push(gte(auditEvents.createdAt, from));

  const to = filter.to ? new Date(filter.to) : null;
  if (to && !Number.isNaN(to.getTime())) {
    // The end of the chosen day, so "to 12 Aug" includes everything on the 12th.
    to.setUTCDate(to.getUTCDate() + 1);
    parts.push(lt(auditEvents.createdAt, to));
  }

  if (historyDays !== null) {
    const floor = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
    parts.push(gte(auditEvents.createdAt, floor));
  }

  return and(...parts);
}

function shape(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    actor: row.actorLabel,
    action: row.action as AuditAction,
    resource: row.resource,
    ip: row.ip,
    at: row.createdAt.toISOString(),
    result: row.result,
  };
}

/**
 * Escapes one CSV cell.
 *
 * A comma, a quote, or a newline needs quoting. A leading =, +, -, or @ needs
 * more than that: a spreadsheet reads it as a formula and runs it. A task named
 * =cmd|'/c calc'!A1 would execute when somebody opened the report. Prefixing a
 * single quote makes the spreadsheet treat the whole cell as text.
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function toCsv(events: AuditEvent[]): string {
  const head = ['Actor', 'Action', 'Action code', 'Resource', 'Source IP', 'When', 'Result'];
  const lines = [head.join(',')];

  for (const event of events) {
    lines.push(
      [
        cell(event.actor),
        cell(ACTION_LABEL[event.action] ?? event.action),
        cell(event.action),
        cell(event.resource),
        cell(event.ip ?? ''),
        cell(event.at),
        cell(event.result),
      ].join(','),
    );
  }

  // A leading BOM, so Excel reads the file as UTF-8 rather than guessing.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** A filename nobody has to rename. */
function filename(extension: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `cerberus-audit-${stamp}.${extension}`;
}

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const filter = readFilter(request);
    const history = LIMITS[session.organization.plan].historyDays;
    const where = conditions(session.organization.id, filter, history);

    const query = request.query as Record<string, string | undefined>;
    const page = Math.max(0, Number(query.page ?? 0) || 0);

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.createdAt))
        .limit(PAGE_SIZE)
        .offset(page * PAGE_SIZE),
      db.select({ n: count() }).from(auditEvents).where(where),
    ]);

    return reply.send({ events: rows.map(shape), total: totals?.n ?? 0 });
  });

  /** Every distinct actor, so the filter can offer a list rather than a box. */
  app.get('/api/audit/actors', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const rows = await db
      .selectDistinct({ actor: auditEvents.actorLabel })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, session.organization.id))
      .orderBy(auditEvents.actorLabel)
      .limit(200);

    return reply.send({ actors: rows.map((row) => row.actor) });
  });

  app.get('/api/audit/export', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const query = request.query as Record<string, string | undefined>;
    const format = query.format === 'pdf' ? 'pdf' : 'csv';

    const filter = readFilter(request);
    const history = LIMITS[session.organization.plan].historyDays;

    const rows = await db
      .select()
      .from(auditEvents)
      .where(conditions(session.organization.id, filter, history))
      .orderBy(desc(auditEvents.createdAt))
      .limit(EXPORT_CAP);

    const events = rows.map(shape);

    /*
       The whole workspace hears about this, not just the person who did it.

       Somebody taking a copy of the audit trail is exactly the kind of thing
       everybody should see, whoever did it.
    */
    notifyLater(
      {
        organizationId: session.organization.id,
        source: 'workspace',
        title: `${session.user.fullName} exported the audit log`,
        body: `${events.length} ${events.length === 1 ? 'row' : 'rows'} as ${format.toUpperCase()}, covering ${describeFilter(filter)}.`,
        href: '/audit',
      },
      request.log,
    );

    // Exporting the log is itself a privileged action, so it leaves a row.
    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'audit.export',
      resource: `${events.length} rows, ${describeFilter(filter)}`,
      detail: { format },
    });

    if (format === 'csv') {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename('csv')}"`)
        .send(toCsv(events));
    }

    const pdf = await buildPdf(events, {
      workspace: session.organization.name,
      filter: describeFilter(filter),
      by: session.user.email,
      truncated: events.length >= EXPORT_CAP,
    });

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename('pdf')}"`)
      .send(pdf);
  });
}
