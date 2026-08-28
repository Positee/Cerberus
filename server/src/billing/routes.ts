import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { organizations } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { fail } from '../http/errors.js';
import { readUsage } from '../http/plan.js';
import type { Subscription, Usage } from '../../../shared/plans.js';

/**
 * The plan page.
 *
 * Read only. Nothing here changes a plan, because billing is not connected. A
 * plan changes in the database. See PLAN_CHANGE_NOTE in shared/plans.ts.
 */

export type PlanPayload = {
  subscription: Subscription;
  usage: Usage;
};

export default async function billingRoutes(app: FastifyInstance) {
  app.get('/api/plan', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const [row] = await db
      .select({
        plan: organizations.plan,
        billingPeriod: organizations.billingPeriod,
        planSince: organizations.planSince,
      })
      .from(organizations)
      .where(eq(organizations.id, session.organization.id))
      .limit(1);

    if (!row) return reply.code(404).send(fail('not_found', 'That workspace is gone.'));

    const usage = await readUsage(session.organization.id);

    return reply.send({
      subscription: {
        plan: row.plan,
        period: row.billingPeriod,
        since: row.planSince.toISOString(),
      },
      usage,
    } satisfies PlanPayload);
  });
}
