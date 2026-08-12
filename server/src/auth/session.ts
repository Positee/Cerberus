import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { memberships, organizations, sessions, users } from '../db/schema.js';
import { isProduction } from '../env.js';
import type { SessionPayload } from '../../../shared/api.js';

export const COOKIE_NAME = 'cerberus_session';
const LIFETIME_DAYS = 7;

/**
 * The cookie holds a random token. The database holds only its SHA-256.
 * Someone who reads the sessions table still cannot sign in as anybody.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  organizationId: string,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    organizationId,
    expiresAt,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: LIFETIME_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Returns the signed-in user, or null. Expired rows never match. */
export async function readSession(request: FastifyRequest): Promise<SessionPayload | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;

  const rows = await db
    .select({
      user: users,
      organization: organizations,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .innerJoin(
      memberships,
      and(eq(memberships.userId, sessions.userId), eq(memberships.organizationId, sessions.organizationId)),
    )
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    user: {
      id: row.user.id,
      email: row.user.email,
      fullName: row.user.fullName,
      githubHandle: row.user.githubHandle,
      primaryStack: row.user.primaryStack,
    },
    organization: {
      id: row.organization.id,
      name: row.organization.name,
      slug: row.organization.slug,
      kind: row.organization.kind,
      teamSize: row.organization.teamSize,
      useCase: row.organization.useCase,
    },
    role: row.role,
  };
}

/** Housekeeping. Called on boot so expired rows do not pile up. */
export async function purgeExpiredSessions(): Promise<number> {
  const removed = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return removed.length;
}
