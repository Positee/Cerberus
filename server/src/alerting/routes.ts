import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { alertRules, contactPoints, notificationPolicies, notificationRoutes } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';
import { SEVERITY_ORDER } from '../../../shared/severity.js';
import {
  DEFAULT_POLICY,
  INTEGRATION_FIELDS,
  normaliseCondition,
  type AlertRule,
  type ContactPoint,
  type Integration,
  type IntegrationType,
  type NotificationPolicy,
} from '../../../shared/alerting.js';

/**
 * Alerting.
 *
 * Rules, contact points, and the routing policy. Nothing here evaluates a
 * rule or sends a message yet. This is the configuration surface, and it
 * stores exactly what an evaluator will later read.
 */

const severityField = z.enum(SEVERITY_ORDER as [string, ...string[]]);

/** One value per filter, or null for any. */
const conditionSchema = z.object({
  trigger: z.enum([
    'finding.raised',
    'finding.reopened',
    'sla.breached',
    'scanner.offline',
    'asset.exposed',
  ]),
  severity: severityField.nullable(),
  source: z.string().trim().min(1).max(60).nullable(),
  assetKind: z.string().trim().min(1).max(60).nullable(),
  count: z.number().int().min(1).max(1000),
  windowMinutes: z.number().int().min(0).max(10080),
});

const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Name the rule.').max(120),
  description: z.string().trim().max(400).optional(),
  enabled: z.boolean(),
  severity: severityField,
  condition: conditionSchema,
  labels: z.record(z.string().trim().max(60), z.string().trim().max(200)),
});

const integrationSchema = z.object({
  type: z.enum(['email', 'google_chat', 'slack', 'webhook', 'phone', 'sms']),
  settings: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

const contactPointSchema = z.object({
  name: z.string().trim().min(1, 'Name the contact point.').max(80),
  integrations: z.array(integrationSchema).min(1, 'Add at least one way to reach somebody.').max(10),
});

const matcherSchema = z.object({
  label: z.string().trim().min(1).max(60),
  operator: z.enum(['=', '!=']),
  value: z.string().trim().max(200),
});

const policySchema = z.object({
  defaultContactPointId: z.string().uuid().nullable(),
  groupBy: z.array(z.string().trim().min(1).max(60)).max(10),
  groupWaitSeconds: z.number().int().min(0).max(3600),
  groupIntervalSeconds: z.number().int().min(10).max(86400),
  repeatIntervalSeconds: z.number().int().min(60).max(604800),
  routes: z
    .array(
      z.object({
        position: z.number().int().min(0).max(500),
        matchers: z.array(matcherSchema).max(10),
        contactPointId: z.string().uuid(),
        continueMatching: z.boolean(),
      }),
    )
    .max(100),
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
  const context = {
    role: session.role,
    kind: session.organization.kind,
    policy: session.organization.policy,
  };

  if (can(permission, context)) return true;

  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

/** Shows that a secret exists without handing it back. */
function mask(value: string): string {
  const tail = value.slice(-4);
  return `••••${tail}`;
}

type StoredSecrets = Record<string, Record<string, string>>;

/**
 * Builds what the browser sees.
 *
 * A secret never leaves the API. Its slot carries a masked hint instead, and
 * the key is listed so a screen can tell "set" from "empty".
 */
function toContactPoint(
  row: {
    id: string;
    name: string;
    integrations: unknown;
    secrets: unknown;
    createdAt: Date;
  },
  usedIds: Set<string>,
): ContactPoint {
  const stored = (row.secrets ?? {}) as StoredSecrets;
  const raw = (row.integrations ?? []) as Array<{ type: IntegrationType; settings: Record<string, string | string[]> }>;

  const integrations: Integration[] = raw.map((integration, index) => {
    const held = stored[String(index)] ?? {};
    const secretKeys = INTEGRATION_FIELDS[integration.type]
      .filter((field) => field.secret && held[field.key])
      .map((field) => field.key);

    const settings = { ...integration.settings };
    for (const key of secretKeys) settings[key] = mask(held[key] ?? '');

    return { type: integration.type, settings, secrets: secretKeys };
  });

  return {
    id: row.id,
    name: row.name,
    integrations,
    unused: !usedIds.has(row.id),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Splits a saved contact point into what may be shown and what may not.
 *
 * An empty secret field means "leave what is already there", so editing a
 * name does not wipe a webhook URL the form never received.
 */
function splitSecrets(
  incoming: z.infer<typeof contactPointSchema>['integrations'],
  previous: StoredSecrets,
): { integrations: Array<{ type: IntegrationType; settings: Record<string, string | string[]> }>; secrets: StoredSecrets } {
  const secrets: StoredSecrets = {};
  const integrations = incoming.map((integration, index) => {
    const settings: Record<string, string | string[]> = { ...integration.settings };
    const held: Record<string, string> = {};

    for (const field of INTEGRATION_FIELDS[integration.type]) {
      if (!field.secret) continue;

      const value = settings[field.key];
      delete settings[field.key];

      const supplied = typeof value === 'string' ? value.trim() : '';
      const kept = previous[String(index)]?.[field.key];

      // A masked hint means the form is echoing back what it was shown.
      if (supplied && !supplied.startsWith('••••')) held[field.key] = supplied;
      else if (kept) held[field.key] = kept;
    }

    if (Object.keys(held).length > 0) secrets[String(index)] = held;
    return { type: integration.type, settings };
  });

  return { integrations, secrets };
}

function toRule(row: typeof alertRules.$inferSelect): AlertRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    severity: row.severity as AlertRule['severity'],
    // A row written under the older list shape still reads.
    condition: normaliseCondition(row.condition),
    labels: (row.labels ?? {}) as Record<string, string>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every contact point some route or the default policy points at. */
async function usedContactPointIds(organizationId: string): Promise<Set<string>> {
  const [policy] = await db
    .select({ id: notificationPolicies.defaultContactPointId })
    .from(notificationPolicies)
    .where(eq(notificationPolicies.organizationId, organizationId))
    .limit(1);

  const routes = await db
    .select({ id: notificationRoutes.contactPointId })
    .from(notificationRoutes)
    .where(eq(notificationRoutes.organizationId, organizationId));

  const used = new Set(routes.map((route) => route.id));
  if (policy?.id) used.add(policy.id);
  return used;
}

export default async function alertingRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------- rules -- */

  app.get('/api/alerting/rules', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const rows = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.organizationId, session.organization.id))
      .orderBy(asc(alertRules.name));

    return reply.send({ rules: rows.map(toRule) });
  });

  app.post('/api/alerting/rules', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const parsed = ruleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the rule.', fieldErrors(parsed.error)));
    }

    const rows = await db
      .insert(alertRules)
      .values({
        organizationId: session.organization.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        enabled: parsed.data.enabled,
        severity: parsed.data.severity,
        condition: parsed.data.condition,
        labels: parsed.data.labels,
        createdBy: session.user.id,
      })
      .returning();

    const row = rows[0];
    if (!row) return reply.code(500).send(fail('server_error', 'The rule was not written.'));

    return reply.code(201).send(toRule(row));
  });

  app.patch('/api/alerting/rules/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = ruleSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the rule.', fieldErrors(parsed.error)));
    }

    const rows = await db
      .update(alertRules)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
        ...(parsed.data.condition !== undefined ? { condition: parsed.data.condition } : {}),
        ...(parsed.data.labels !== undefined ? { labels: parsed.data.labels } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That rule is gone.'));

    return reply.send(toRule(row));
  });

  app.delete('/api/alerting/rules/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    await db
      .delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, session.organization.id)));

    return reply.code(204).send();
  });

  /* ---------------------------------------------------- contact points -- */

  app.get('/api/alerting/contact-points', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const used = await usedContactPointIds(session.organization.id);
    const rows = await db
      .select()
      .from(contactPoints)
      .where(eq(contactPoints.organizationId, session.organization.id))
      .orderBy(asc(contactPoints.name));

    return reply.send({ contactPoints: rows.map((row) => toContactPoint(row, used)) });
  });

  app.post('/api/alerting/contact-points', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const parsed = contactPointSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the contact point.', fieldErrors(parsed.error)));
    }

    const { integrations, secrets } = splitSecrets(parsed.data.integrations, {});

    const existing = await db
      .select({ id: contactPoints.id })
      .from(contactPoints)
      .where(and(eq(contactPoints.organizationId, session.organization.id), eq(contactPoints.name, parsed.data.name)))
      .limit(1);

    if (existing.length > 0) {
      return reply
        .code(409)
        .send(fail('invalid_request', 'That name is taken.', { name: 'That name is taken.' }));
    }

    const rows = await db
      .insert(contactPoints)
      .values({ organizationId: session.organization.id, name: parsed.data.name, integrations, secrets })
      .returning();

    const row = rows[0];
    if (!row) return reply.code(500).send(fail('server_error', 'The contact point was not written.'));

    return reply.code(201).send(toContactPoint(row, new Set()));
  });

  app.patch('/api/alerting/contact-points/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = contactPointSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the contact point.', fieldErrors(parsed.error)));
    }

    const [before] = await db
      .select({ secrets: contactPoints.secrets })
      .from(contactPoints)
      .where(and(eq(contactPoints.id, id), eq(contactPoints.organizationId, session.organization.id)))
      .limit(1);

    if (!before) return reply.code(404).send(fail('not_found', 'That contact point is gone.'));

    const { integrations, secrets } = splitSecrets(
      parsed.data.integrations,
      (before.secrets ?? {}) as StoredSecrets,
    );

    const rows = await db
      .update(contactPoints)
      .set({ name: parsed.data.name, integrations, secrets, updatedAt: new Date() })
      .where(and(eq(contactPoints.id, id), eq(contactPoints.organizationId, session.organization.id)))
      .returning();

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That contact point is gone.'));

    const used = await usedContactPointIds(session.organization.id);
    return reply.send(toContactPoint(row, used));
  });

  app.delete('/api/alerting/contact-points/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const { id } = request.params as { id: string };

    // Deleting one still in use would quietly drop the routes that name it.
    const used = await usedContactPointIds(session.organization.id);
    if (used.has(id)) {
      return reply
        .code(409)
        .send(fail('invalid_request', 'A notification policy still sends to this. Detach it first.'));
    }

    await db
      .delete(contactPoints)
      .where(and(eq(contactPoints.id, id), eq(contactPoints.organizationId, session.organization.id)));

    return reply.code(204).send();
  });

  /* --------------------------------------------------------- the policy -- */

  app.get('/api/alerting/policy', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    return reply.send(await readPolicy(session.organization.id));
  });

  app.put('/api/alerting/policy', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'alert.manage'))) return;

    const parsed = policySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the policy.', fieldErrors(parsed.error)));
    }

    const owned = await db
      .select({ id: contactPoints.id })
      .from(contactPoints)
      .where(eq(contactPoints.organizationId, session.organization.id));

    const ownedIds = new Set(owned.map((row) => row.id));
    const named = [
      ...(parsed.data.defaultContactPointId ? [parsed.data.defaultContactPointId] : []),
      ...parsed.data.routes.map((route) => route.contactPointId),
    ];

    // A route must not point at another workspace's contact point.
    if (named.some((id) => !ownedIds.has(id))) {
      return reply.code(400).send(fail('invalid_request', 'A route names a contact point that is not here.'));
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(notificationPolicies)
        .values({
          organizationId: session.organization.id,
          defaultContactPointId: parsed.data.defaultContactPointId,
          groupBy: parsed.data.groupBy,
          groupWaitSeconds: parsed.data.groupWaitSeconds,
          groupIntervalSeconds: parsed.data.groupIntervalSeconds,
          repeatIntervalSeconds: parsed.data.repeatIntervalSeconds,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: notificationPolicies.organizationId,
          set: {
            defaultContactPointId: parsed.data.defaultContactPointId,
            groupBy: parsed.data.groupBy,
            groupWaitSeconds: parsed.data.groupWaitSeconds,
            groupIntervalSeconds: parsed.data.groupIntervalSeconds,
            repeatIntervalSeconds: parsed.data.repeatIntervalSeconds,
            updatedAt: new Date(),
          },
        });

      // The routes are an ordered list, so they are replaced whole.
      await tx.delete(notificationRoutes).where(eq(notificationRoutes.organizationId, session.organization.id));

      if (parsed.data.routes.length > 0) {
        await tx.insert(notificationRoutes).values(
          parsed.data.routes.map((route, index) => ({
            organizationId: session.organization.id,
            position: index,
            matchers: route.matchers,
            contactPointId: route.contactPointId,
            continueMatching: route.continueMatching,
          })),
        );
      }
    });

    return reply.send(await readPolicy(session.organization.id));
  });
}

async function readPolicy(organizationId: string): Promise<NotificationPolicy> {
  const [row] = await db
    .select()
    .from(notificationPolicies)
    .where(eq(notificationPolicies.organizationId, organizationId))
    .limit(1);

  const routes = await db
    .select()
    .from(notificationRoutes)
    .where(eq(notificationRoutes.organizationId, organizationId))
    .orderBy(asc(notificationRoutes.position));

  return {
    defaultContactPointId: row?.defaultContactPointId ?? null,
    groupBy: (row?.groupBy as string[]) ?? DEFAULT_POLICY.groupBy,
    groupWaitSeconds: row?.groupWaitSeconds ?? DEFAULT_POLICY.groupWaitSeconds,
    groupIntervalSeconds: row?.groupIntervalSeconds ?? DEFAULT_POLICY.groupIntervalSeconds,
    repeatIntervalSeconds: row?.repeatIntervalSeconds ?? DEFAULT_POLICY.repeatIntervalSeconds,
    routes: routes.map((route) => ({
      id: route.id,
      position: route.position,
      matchers: route.matchers as NotificationPolicy['routes'][number]['matchers'],
      contactPointId: route.contactPointId,
      continueMatching: route.continueMatching,
    })),
  };
}
