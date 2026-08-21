import { and, asc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { memberships, organizations, users } from '../db/schema.js';
import { publicOrganizationColumns, toPublicOrganization } from '../auth/present.js';
import { readSession } from '../auth/session.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload, WorkspaceMember } from '../../../shared/api.js';
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_PATTERN } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';

/**
 * The workspace routes.
 *
 * Every route asks shared/permissions.ts the same question the browser asked
 * before it drew the screen. A hidden button is a courtesy. This is the
 * control.
 */

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_MIN_LENGTH, `Use ${SLUG_MIN_LENGTH} characters or more.`)
  .max(SLUG_MAX_LENGTH, `Use ${SLUG_MAX_LENGTH} characters or fewer.`)
  .regex(SLUG_PATTERN, 'Use lower case letters, numbers, and single hyphens.');

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120).optional(),
  slug: slugField.optional(),
  policy: z
    .object({
      membersCanInvite: z.boolean().optional(),
      membersCanCreateProjects: z.boolean().optional(),
      membersCanManageAlerts: z.boolean().optional(),
    })
    .optional(),
});

const updateMemberSchema = z.object({
  // An owner is made by transfer, not by picking the role from a list.
  role: z.enum(['admin', 'member', 'viewer']),
});

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionPayload | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return null;
  }
  return session;
}

/** Answers 403 and returns false when the role does not reach far enough. */
async function allow(
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

  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

export default async function workspaceRoutes(app: FastifyInstance) {
  /** Everybody in the workspace, owner first. */
  app.get('/api/workspace/members', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const rows = await db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        role: memberships.role,
        jobTitle: memberships.jobTitle,
        avatarUpdatedAt: users.avatarUpdatedAt,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, session.organization.id))
      .orderBy(asc(memberships.createdAt));

    const members: WorkspaceMember[] = rows.map((row) => ({
      membershipId: row.membershipId,
      userId: row.userId,
      fullName: row.fullName,
      email: row.email,
      role: row.role,
      jobTitle: row.jobTitle,
      avatarUpdatedAt: row.avatarUpdatedAt?.toISOString() ?? null,
      joinedAt: row.joinedAt.toISOString(),
    }));

    return reply.send({ members });
  });

  /** The display name, the slug, and the policy switches. */
  app.patch('/api/workspace', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.settings'))) return;

    const parsed = updateWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    const { name, slug, policy } = parsed.data;

    if (slug) {
      const taken = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.slug, slug), ne(organizations.id, session.organization.id)))
        .limit(1);

      if (taken.length > 0) {
        return reply
          .code(409)
          .send(fail('invalid_request', 'That slug is taken.', { slug: 'That slug is taken.' }));
      }
    }

    // A personal workspace is flat, so its switches stay where they are.
    const policyChange =
      session.organization.kind === 'organization' && policy
        ? {
            ...(policy.membersCanInvite !== undefined ? { membersCanInvite: policy.membersCanInvite } : {}),
            ...(policy.membersCanCreateProjects !== undefined
              ? { membersCanCreateProjects: policy.membersCanCreateProjects }
              : {}),
            ...(policy.membersCanManageAlerts !== undefined
              ? { membersCanManageAlerts: policy.membersCanManageAlerts }
              : {}),
          }
        : {};

    const change = {
      ...(name ? { name } : {}),
      ...(slug ? { slug } : {}),
      ...policyChange,
    };

    if (Object.keys(change).length === 0) {
      return reply.send(session.organization);
    }

    const rows = await db
      .update(organizations)
      .set(change)
      .where(eq(organizations.id, session.organization.id))
      .returning(publicOrganizationColumns);

    const row = rows[0];
    if (!row) return reply.code(404).send(fail('not_found', 'That workspace is gone.'));

    return reply.send(toPublicOrganization(row));
  });

  /** Changes somebody's role. */
  app.patch('/api/workspace/members/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'member.manage'))) return;

    const { id } = request.params as { id: string };
    const parsed = updateMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Pick a role.', fieldErrors(parsed.error)));
    }

    const target = await findMember(session.organization.id, id);
    if (!target) return reply.code(404).send(fail('not_found', 'That person is not in this workspace.'));

    if (target.role === 'owner') {
      return reply.code(403).send(fail('unauthorized', 'The owner keeps the owner role. Transfer it instead.'));
    }

    const rows = await db
      .update(memberships)
      .set({ role: parsed.data.role })
      .where(eq(memberships.id, id))
      .returning({ id: memberships.id, role: memberships.role });

    return reply.send(rows[0]);
  });

  /** Removes somebody from the workspace. */
  app.delete('/api/workspace/members/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const target = await findMember(session.organization.id, id);
    if (!target) return reply.code(404).send(fail('not_found', 'That person is not in this workspace.'));

    // Anybody may show themselves out. Removing somebody else needs the role.
    const leaving = target.userId === session.user.id;
    if (!leaving && !(await allow(reply, session, 'member.manage'))) return;

    if (target.role === 'owner') {
      return reply
        .code(403)
        .send(fail('unauthorized', 'The owner cannot be removed. Transfer the workspace first.'));
    }

    await db.delete(memberships).where(eq(memberships.id, id));
    return reply.code(204).send();
  });
}

async function findMember(organizationId: string, membershipId: string) {
  const rows = await db
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .limit(1);

  return rows[0] ?? null;
}
