import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { memberships, organizations, sessions, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { publicUserColumns, toPublicUser } from '../auth/present.js';
import { createSession, destroySession, readSession } from '../auth/session.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { AvatarType, PublicUser, SessionPayload } from '../../../shared/api.js';
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from '../../../shared/api.js';
import { EMAIL_PATTERN, PASSWORD_MAX_LENGTH, gradePassword, normalizeEmail } from '../../../shared/password.js';

/**
 * The profile routes.
 *
 * Every route needs a session. Changing an email address, changing a
 * password, and deleting an account each need the current password as well,
 * because an unlocked screen must not be enough to take an account.
 */

const emailField = z.string().trim().toLowerCase().regex(EMAIL_PATTERN, 'Enter a valid email address.');

/** The API re-checks the policy. The form is a convenience, not a control. */
const newPasswordField = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const grade = gradePassword(value);
    if (!grade.valid) {
      ctx.addIssue({ code: 'custom', message: `The password needs ${grade.missing.join(', ')}.` });
    }
  });

/** An empty box clears the field, so an empty string becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(120),
  githubHandle: optionalText(80),
  primaryStack: optionalText(80),
});

const emailSchema = z.object({
  email: emailField,
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH),
});

const passwordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordField,
});

const deleteSchema = z.object({ currentPassword: z.string().max(PASSWORD_MAX_LENGTH) });

/** Answers 401 and returns null when nobody is signed in. */
async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionPayload | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return null;
  }
  return session;
}

/**
 * Checks the password the form supplied against the stored hash.
 *
 * A wrong password is the same answer everywhere, so the caller never has to
 * decide what to say.
 */
async function passwordMatches(userId: string, plain: string): Promise<boolean> {
  const rows = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  const hash = rows[0]?.hash;
  if (!hash) return false;
  return verifyPassword(hash, plain);
}

const WRONG_PASSWORD = fail('invalid_credentials', 'That password is wrong.', {
  currentPassword: 'That password is wrong.',
});

export default async function profileRoutes(app: FastifyInstance) {
  /** Name, GitHub handle, and primary stack. None of these is a secret. */
  app.patch('/api/profile', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    const rows = await db
      .update(users)
      .set({
        fullName: parsed.data.fullName,
        githubHandle: parsed.data.githubHandle,
        primaryStack: parsed.data.primaryStack,
      })
      .where(eq(users.id, session.user.id))
      .returning(publicUserColumns);

    const row = rows[0];
    if (!row) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    return reply.send(toPublicUser(row));
  });

  /** A new email address. It needs the current password. */
  app.patch('/api/profile/email', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    if (!(await passwordMatches(session.user.id, parsed.data.currentPassword))) {
      return reply.code(401).send(WRONG_PASSWORD);
    }

    const address = normalizeEmail(parsed.data.email);
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, address), ne(users.id, session.user.id)))
      .limit(1);

    if (taken.length > 0) {
      return reply
        .code(409)
        .send(fail('email_taken', 'That email already has an account.', { email: 'That email already has an account.' }));
    }

    const rows = await db
      .update(users)
      .set({ email: address })
      .where(eq(users.id, session.user.id))
      .returning(publicUserColumns);

    const row = rows[0];
    if (!row) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    return reply.send(toPublicUser(row));
  });

  /**
   * A new password.
   *
   * Every other session ends. A password change is what someone does after
   * they think an account is exposed, so the other devices must drop.
   */
  app.patch('/api/profile/password', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the form.', fieldErrors(parsed.error)));
    }

    if (!(await passwordMatches(session.user.id, parsed.data.currentPassword))) {
      return reply.code(401).send(WRONG_PASSWORD);
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, session.user.id));

    await db.delete(sessions).where(eq(sessions.userId, session.user.id));
    await createSession(request, reply, session.user.id, session.organization.id);

    return reply.code(204).send();
  });

  /** The picture itself. The URL carries a version, so it caches hard. */
  app.get('/api/profile/avatar', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const rows = await db
      .select({ avatar: users.avatar, avatarType: users.avatarType })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    const row = rows[0];
    if (!row?.avatar) return reply.code(404).send(fail('not_found', 'There is no picture.'));

    return reply
      .header('content-type', row.avatarType ?? 'image/png')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(row.avatar);
  });

  /**
   * A new picture.
   *
   * The browser crops and resizes it first, so the body is a small square
   * image and the API needs no image library and no native dependency.
   */
  app.put('/api/profile/avatar', { bodyLimit: AVATAR_MAX_BYTES }, async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    if (!AVATAR_TYPES.includes(type as AvatarType)) {
      return reply.code(415).send(fail('invalid_request', 'Send a PNG, a JPEG, or a WebP image.'));
    }

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send(fail('invalid_request', 'The image is empty.'));
    }

    const now = new Date();
    await db
      .update(users)
      .set({ avatar: body, avatarType: type, avatarUpdatedAt: now })
      .where(eq(users.id, session.user.id));

    return reply.send({ ...session.user, avatarUpdatedAt: now.toISOString() } satisfies PublicUser);
  });

  app.delete('/api/profile/avatar', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    await db
      .update(users)
      .set({ avatar: null, avatarType: null, avatarUpdatedAt: null })
      .where(eq(users.id, session.user.id));

    return reply.send({ ...session.user, avatarUpdatedAt: null } satisfies PublicUser);
  });

  /**
   * Removes the account.
   *
   * Deleting the user cascades to its memberships and its sessions. A
   * workspace that keeps no member after that is removed as well, so an empty
   * organization never lingers.
   */
  app.delete('/api/profile', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Enter your password.', fieldErrors(parsed.error)));
    }

    if (!(await passwordMatches(session.user.id, parsed.data.currentPassword))) {
      return reply.code(401).send(WRONG_PASSWORD);
    }

    await db.transaction(async (tx) => {
      const owned = await tx
        .select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(eq(memberships.userId, session.user.id));

      await tx.delete(users).where(eq(users.id, session.user.id));

      for (const row of owned) {
        const remaining = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.organizationId, row.organizationId))
          .limit(1);

        if (remaining.length === 0) {
          await tx.delete(organizations).where(eq(organizations.id, row.organizationId));
        }
      }
    });

    await destroySession(request, reply);
    return reply.code(204).send();
  });
}
