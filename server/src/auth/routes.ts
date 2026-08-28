import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { memberships, organizations, users } from '../db/schema.js';
import { burnTime, hashPassword, verifyPassword } from './password.js';
import {
  publicOrganizationColumns,
  publicUserColumns,
  toPublicOrganization,
  toPublicUser,
} from './present.js';
import { createSession, destroySession, readSession } from './session.js';
import { record, recordDenied } from '../audit/record.js';
import { checkLock, clearFailures, lockMessage, noteFailure } from './lockout.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload } from '../../../shared/api.js';
import { EMAIL_PATTERN, PASSWORD_MAX_LENGTH, gradePassword, normalizeEmail } from '../../../shared/password.js';

const email = z.string().trim().toLowerCase().regex(EMAIL_PATTERN, 'Enter a valid email address.');

// The server re-checks the policy. The form is a convenience, not a control.
const password = z.string().max(PASSWORD_MAX_LENGTH).superRefine((value, ctx) => {
  const grade = gradePassword(value);
  if (!grade.valid) {
    ctx.addIssue({ code: 'custom', message: `The password needs ${grade.missing.join(', ')}.` });
  }
});

const signupSchema = z
  .object({
    accountType: z.enum(['personal', 'organization']),
    fullName: z.string().trim().min(1, 'Enter your name.').max(120),
    email,
    password,
    githubHandle: z.string().trim().max(80).optional(),
    primaryStack: z.string().trim().max(80).optional(),
    organizationName: z.string().trim().max(120).optional(),
    teamSize: z.string().trim().max(40).optional(),
    jobTitle: z.string().trim().max(80).optional(),
    useCase: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === 'organization' && !value.organizationName) {
      ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter the organization name.' });
    }
  });

const loginSchema = z.object({ email, password: z.string().max(PASSWORD_MAX_LENGTH) });

/** Slugs must be unique. A short random suffix avoids a retry loop. */
function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    const input = parsed.data;
    const address = normalizeEmail(input.email);

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, address)).limit(1);
    if (existing.length > 0) {
      return reply
        .code(409)
        .send(fail('email_taken', 'That email already has an account.', { email: 'That email already has an account.' }));
    }

    const passwordHash = await hashPassword(input.password);
    const isPersonal = input.accountType === 'personal';
    const orgName = isPersonal ? `${input.fullName}'s workspace` : (input.organizationName ?? 'Workspace');

    // One transaction. A half-created account with no organization is worse
    // than a failed signup.
    const payload = await db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: orgName,
          slug: toSlug(orgName),
          kind: input.accountType,
          teamSize: isPersonal ? null : (input.teamSize ?? null),
          useCase: isPersonal ? null : (input.useCase ?? null),
        })
        .returning(publicOrganizationColumns);

      const [user] = await tx
        .insert(users)
        .values({
          email: address,
          passwordHash,
          fullName: input.fullName,
          githubHandle: isPersonal ? (input.githubHandle ?? null) : null,
          primaryStack: isPersonal ? (input.primaryStack ?? null) : null,
        })
        .returning(publicUserColumns);

      if (!organization || !user) throw new Error('Insert returned no row.');

      await tx.insert(memberships).values({
        userId: user.id,
        organizationId: organization.id,
        // Whoever creates the workspace owns it.
        role: 'owner',
        jobTitle: isPersonal ? null : (input.jobTitle ?? null),
      });

      return {
        user: toPublicUser(user),
        organization: toPublicOrganization(organization),
        role: 'owner',
      } satisfies SessionPayload;
    });

    await createSession(request, reply, payload.user.id, payload.organization.id);

    record(request, {
      organizationId: payload.organization.id,
      actorUserId: payload.user.id,
      actor: payload.user.email,
      action: 'auth.signup',
      resource: payload.organization.name,
    });
    return reply.code(201).send(payload);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Enter your email and password.'));
    }

    const address = normalizeEmail(parsed.data.email);
    // The hash is the only private column this route needs.
    const lock = await checkLock(address);
    if (lock.locked) {
      return reply.code(429).send(fail('invalid_credentials', lockMessage(lock.minutesLeft)));
    }

    const rows = await db
      .select({ ...publicUserColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, address))
      .limit(1);
    const user = rows[0];

    if (!user) {
      // Spend the same time as a real verify, then give the same message. The
      // failure is counted as well, so an address that belongs to nobody locks
      // on the same schedule and the lock tells an attacker nothing.
      await burnTime();
      const state = await noteFailure(address);
      if (state.locked) {
        return reply.code(429).send(fail('invalid_credentials', lockMessage(state.minutesLeft)));
      }
      return reply.code(401).send(fail('invalid_credentials', 'That email or password is wrong.'));
    }

    const ok = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!ok) {
      /*
         A refused sign in is the row an auditor most wants, so it is written
         against the workspace somebody tried to reach.

         An unknown email cannot be recorded at all, because it belongs to no
         workspace and nobody would ever be able to read it. The reply is
         identical either way, so this leaks nothing about which emails exist.
      */
      const [attempted] = await db
        .select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(eq(memberships.userId, user.id))
        .limit(1);

      const state = await noteFailure(address);

      if (attempted) {
        recordDenied(request, {
          organizationId: attempted.organizationId,
          actorUserId: user.id,
          actor: address,
          action: 'auth.login',
          resource: state.locked ? `The console, locked for ${state.minutesLeft} minutes` : 'The console',
        });
      }

      if (state.locked) {
        return reply.code(429).send(fail('invalid_credentials', lockMessage(state.minutesLeft)));
      }

      return reply.code(401).send(fail('invalid_credentials', 'That email or password is wrong.'));
    }

    const membershipRows = await db
      .select({ organization: publicOrganizationColumns, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, user.id))
      .limit(1);

    const membership = membershipRows[0];
    if (!membership) {
      return reply.code(401).send(fail('invalid_credentials', 'That account has no workspace.'));
    }

    await clearFailures(address);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await createSession(request, reply, user.id, membership.organization.id);

    record(request, {
      organizationId: membership.organization.id,
      actorUserId: user.id,
      actor: address,
      action: 'auth.login',
      resource: 'The console',
    });

    return reply.send({
      user: toPublicUser(user),
      organization: toPublicOrganization(membership.organization),
      role: membership.role,
    } satisfies SessionPayload);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    // Read first. After destroySession there is nobody left to name.
    const session = await readSession(request);
    await destroySession(request, reply);

    if (session) {
      record(request, {
        organizationId: session.organization.id,
        actorUserId: session.user.id,
        actor: session.user.email,
        action: 'auth.logout',
        resource: 'The console',
      });
    }

    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return reply.send(session);
  });
}
