import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { invitations, memberships, organizations, users } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record } from '../audit/record.js';
import { fail, fieldErrors } from '../http/errors.js';
import { notifyLater } from '../notifications/notify.js';
import { needsPlan, withinLimit } from '../http/plan.js';
import { env } from '../env.js';
import type {
  InvitationPreview,
  SessionPayload,
  WorkspaceInvitation,
} from '../../../shared/api.js';
import { INVITATION_DAYS } from '../../../shared/api.js';
import { can } from '../../../shared/permissions.js';
import { EMAIL_PATTERN, normalizeEmail } from '../../../shared/password.js';

/**
 * Invitations.
 *
 * Inviting somebody is its own job, so it lives in its own file and answers
 * on its own paths. The workspace routes report who is already inside.
 *
 * The link holds a random token. The row holds only its SHA-256, the same way
 * a session does, so reading this table gives nobody a way in.
 */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN, 'Enter a valid email address.'),
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

function toInvitation(row: {
  id: string;
  email: string;
  role: WorkspaceInvitation['role'];
  invitedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
}): WorkspaceInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export default async function invitationRoutes(app: FastifyInstance) {
  /** Everything still waiting to be accepted. */
  app.get('/api/invitations', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const rows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        invitedBy: users.fullName,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.organizationId, session.organization.id), isNull(invitations.acceptedAt)))
      .orderBy(desc(invitations.createdAt));

    return reply.send({ invitations: rows.map(toInvitation) });
  });

  /** Makes a link. The link is shown once and never stored. */
  app.post('/api/invitations', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const context = {
      role: session.role,
      kind: session.organization.kind,
      policy: session.organization.policy,
    };

    if (!can('member.invite', context)) {
      return reply.code(403).send(fail('unauthorized', 'Your role does not allow inviting people.'));
    }

    if (!(await needsPlan(request, reply, session, 'pro', 'Inviting people'))) return;
    // A pending invitation counts as a seat, so a workspace cannot invite its
    // way past the cap and only discover it when somebody tries to join.
    if (!(await withinLimit(request, reply, session, 'seats'))) return;

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    const email = normalizeEmail(parsed.data.email);

    // A personal workspace is flat, so everybody it invites joins as a member.
    const role = session.organization.kind === 'personal' ? 'member' : parsed.data.role;

    // Somebody already inside does not need a link.
    const seated = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, session.organization.id), eq(users.email, email)))
      .limit(1);

    if (seated.length > 0) {
      return reply
        .code(409)
        .send(fail('invalid_request', 'That person is already here.', { email: 'That person is already here.' }));
    }

    // One live invitation per address. A new one replaces the old link.
    await db
      .delete(invitations)
      .where(
        and(
          eq(invitations.organizationId, session.organization.id),
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
        ),
      );

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db
      .insert(invitations)
      .values({
        organizationId: session.organization.id,
        email,
        role,
        tokenHash: hashToken(token),
        invitedBy: session.user.id,
        expiresAt,
      })
      .returning({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      });

    const row = rows[0];
    if (!row) return reply.code(500).send(fail('server_error', 'The invitation was not written.'));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'member.invite',
      resource: String(parsed.data.email),
    });

    notifyLater(
      {
        organizationId: session.organization.id,
        source: 'workspace',
        title: `${session.user.fullName} invited ${parsed.data.email}`,
        body: `As ${parsed.data.role}. The link works for 7 days.`,
        href: '/invites',
      },
      request.log,
    );

    return reply.code(201).send({
      invitation: toInvitation({ ...row, invitedBy: session.user.fullName }),
      link: `${env.WEB_ORIGIN}/join/${token}`,
    });
  });

  app.delete('/api/invitations/:id', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const context = {
      role: session.role,
      kind: session.organization.kind,
      policy: session.organization.policy,
    };

    if (!can('member.invite', context)) {
      return reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
    }

    const { id } = request.params as { id: string };
    await db
      .delete(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, session.organization.id)));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'invitation.revoke',
      resource: String('Invitation ' + id),
    });

    return reply.code(204).send();
  });

  /**
   * What the link shows before anybody accepts it.
   *
   * This answers without a session, because the person holding the link may
   * not have an account yet. It names the workspace and the role, and nothing
   * else about who is inside.
   */
  app.get('/api/invitations/token/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const rows = await db
      .select({
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        workspaceName: organizations.name,
        workspaceKind: organizations.kind,
        invitedBy: users.fullName,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(eq(invitations.tokenHash, hashToken(token)))
      .limit(1);

    const row = rows[0];
    if (!row || row.acceptedAt || row.expiresAt <= new Date()) {
      return reply.code(404).send(fail('not_found', 'That invitation is used, expired, or wrong.'));
    }

    return reply.send({
      workspaceName: row.workspaceName,
      workspaceKind: row.workspaceKind,
      role: row.role,
      email: row.email,
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.toISOString(),
    } satisfies InvitationPreview);
  });

  /** Joins the workspace. The person must be signed in as the named address. */
  app.post('/api/invitations/token/:token/accept', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { token } = request.params as { token: string };

    const rows = await db
      .select({
        id: invitations.id,
        organizationId: invitations.organizationId,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
      })
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)))
      .limit(1);

    const invite = rows[0];
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      return reply.code(404).send(fail('not_found', 'That invitation is used, expired, or wrong.'));
    }

    // The link names one address. It cannot seat somebody else.
    if (normalizeEmail(session.user.email) !== invite.email) {
      return reply
        .code(403)
        .send(fail('unauthorized', `That invitation is for ${invite.email}. Sign in as that person.`));
    }

    const already = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, invite.organizationId), eq(memberships.userId, session.user.id)))
      .limit(1);

    await db.transaction(async (tx) => {
      if (already.length === 0) {
        await tx.insert(memberships).values({
          userId: session.user.id,
          organizationId: invite.organizationId,
          role: invite.role,
        });
      }

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: session.user.id })
        .where(eq(invitations.id, invite.id));
    });

    const workspace = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId))
      .limit(1);

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'invitation.accept',
      resource: String(session.user.email),
    });

    notifyLater(
      {
        organizationId: session.organization.id,
        source: 'workspace',
        title: `${session.user.fullName} joined the workspace`,
        body: `They accepted an invitation.`,
        href: '/workspace',
      },
      request.log,
    );

    return reply.send({ workspaceName: workspace[0]?.name ?? 'the workspace' });
  });
}

/** Housekeeping. Removes links nobody used before they went stale. */
export async function purgeExpiredInvitations(): Promise<number> {
  const removed = await db
    .delete(invitations)
    .where(and(isNull(invitations.acceptedAt), lt(invitations.expiresAt, new Date())))
    .returning({ id: invitations.id });
  return removed.length;
}
