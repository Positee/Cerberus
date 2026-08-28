import { and, count, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import {
  alertRules,
  contactPoints,
  memberships,
  monitors,
  projects,
  schedules,
} from '../db/schema.js';
import { fail } from './errors.js';
import { recordDenied } from '../audit/record.js';
import type { SessionPayload } from '../../../shared/api.js';
import {
  countLimit,
  LIMITS,
  LIMIT_LABEL,
  MODULE_PLAN,
  PLAN_LABEL,
  planReaches,
  planThatAllows,
  wouldExceed,
  type LimitKey,
  type Plan,
  type Usage,
} from '../../../shared/plans.js';

/**
 * The plan gate.
 *
 * A hidden control is a courtesy, never a control. The sidebar draws a lock and
 * the router sends somebody to the upgrade page, but neither stops a request
 * anybody can write by hand. This does.
 */

/** Refuses when the workspace plan does not reach what a feature needs. */
export async function needsPlan(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionPayload,
  needed: Plan,
  what: string,
): Promise<boolean> {
  if (planReaches(session.organization.plan, needed)) return true;

  // Somebody reaching for a feature they cannot have is worth a row. It says
  // what the workspace wants, and it explains a gap in the trail.
  recordDenied(request, {
    organizationId: session.organization.id,
    actorUserId: session.user.id,
    actor: session.user.email,
    action: 'permission.denied',
    resource: `${what}, needs ${PLAN_LABEL[needed]}`,
  });

  await reply.code(402).send(
    fail('plan_required', `${what} needs the ${PLAN_LABEL[needed]} plan.`, {
      plan: PLAN_LABEL[needed],
    }),
  );
  return false;
}

/** Refuses when the workspace already holds as many as its plan allows. */
export async function withinLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionPayload,
  key: LimitKey,
): Promise<boolean> {
  const plan = session.organization.plan;
  const used = await countOne(session.organization.id, key);

  if (!wouldExceed(key, plan, used)) return true;

  recordDenied(request, {
    organizationId: session.organization.id,
    actorUserId: session.user.id,
    actor: session.user.email,
    action: 'permission.denied',
    resource: `${LIMIT_LABEL[key]} cap reached on ${PLAN_LABEL[plan]}`,
  });

  const cap = LIMITS[plan][key] ?? used;
  const next = planThatAllows(key, used);
  const allowed = countLimit(key, cap);

  const message = next
    ? `The ${PLAN_LABEL[plan]} plan allows ${allowed}. Move to ${PLAN_LABEL[next]} for more.`
    : `The ${PLAN_LABEL[plan]} plan allows ${allowed}.`;

  await reply.code(402).send(fail('plan_required', message));
  return false;
}

/** Counts what a workspace already holds against one cap. */
async function countOne(organizationId: string, key: LimitKey): Promise<number> {
  const one = async (rows: Promise<Array<{ n: number }>>) => (await rows)[0]?.n ?? 0;

  switch (key) {
    case 'seats':
      return one(
        db
          .select({ n: count() })
          .from(memberships)
          .where(eq(memberships.organizationId, organizationId)),
      );
    case 'alertRules':
      return one(
        db.select({ n: count() }).from(alertRules).where(eq(alertRules.organizationId, organizationId)),
      );
    case 'contactPoints':
      return one(
        db
          .select({ n: count() })
          .from(contactPoints)
          .where(eq(contactPoints.organizationId, organizationId)),
      );
    case 'monitors':
      return one(db.select({ n: count() }).from(monitors).where(eq(monitors.organizationId, organizationId)));
    case 'schedules':
      return one(
        db.select({ n: count() }).from(schedules).where(eq(schedules.organizationId, organizationId)),
      );
    case 'projects':
      return one(
        db
          .select({ n: count() })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), isNull(projects.archivedAt))),
      );
    // History is a span, not a count, so nothing is counted against it.
    case 'historyDays':
      return 0;
  }
}

/** Everything a workspace holds, for the meters on the plan page. */
export async function readUsage(organizationId: string): Promise<Usage> {
  const keys: LimitKey[] = [
    'seats',
    'alertRules',
    'contactPoints',
    'monitors',
    'schedules',
    'projects',
    'historyDays',
  ];

  const counted = await Promise.all(keys.map((key) => countOne(organizationId, key)));
  return Object.fromEntries(keys.map((key, index) => [key, counted[index] ?? 0])) as Usage;
}

/** The plan a route needs, worked out from the module it belongs to. */
export function planForPath(path: string): Plan {
  const module = Object.keys(MODULE_PLAN).find((entry) => path.startsWith(entry));
  return module ? (MODULE_PLAN[module] ?? 'free') : 'free';
}
