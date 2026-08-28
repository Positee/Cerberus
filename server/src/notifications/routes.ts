import { and, desc, eq, gt, isNull, isNotNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { announcementReads, announcements, notifications } from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record } from '../audit/record.js';
import { fail } from '../http/errors.js';

/**
 * The bell.
 *
 * A person sees what is addressed to them and what is addressed to the whole
 * workspace. Nothing here writes a notification. Whatever caused it does that.
 */

const PAGE = 30;

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const mine = and(
      eq(notifications.organizationId, session.organization.id),
      // Null means the whole workspace, so it belongs to everybody.
      or(isNull(notifications.userId), eq(notifications.userId, session.user.id)),
    );

    const rows = await db
      .select()
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.createdAt))
      .limit(PAGE);

    const now = new Date();

    /*
       Announcements belong to nobody, so the read mark lives in its own table.
       A left join gives one query instead of two, and a missing row reads as
       unread, which is the right default for something just published.
    */
    const news = await db
      .select({
        id: announcements.id,
        kind: announcements.kind,
        title: announcements.title,
        body: announcements.body,
        href: announcements.href,
        publishedAt: announcements.publishedAt,
        readAt: announcementReads.readAt,
      })
      .from(announcements)
      .leftJoin(
        announcementReads,
        and(
          eq(announcementReads.announcementId, announcements.id),
          eq(announcementReads.userId, session.user.id),
        ),
      )
      .where(
        and(
          // A draft never reaches the bell.
          isNotNull(announcements.publishedAt),
          lte(announcements.publishedAt, now),
          or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
          or(
            eq(announcements.audience, 'all'),
            eq(announcements.audience, session.organization.kind),
          ),
        ),
      )
      .orderBy(desc(announcements.publishedAt))
      .limit(PAGE);

    return reply.send({
      notifications: rows.map((row) => ({
        id: row.id,
        source: row.source,
        title: row.title,
        body: row.body,
        href: row.href,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      announcements: news.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        href: row.href,
        read: row.readAt !== null,
        publishedAt: (row.publishedAt ?? now).toISOString(),
      })),
      unread: rows.filter((row) => row.readAt === null).length,
      unreadNews: news.filter((row) => row.readAt === null).length,
    });
  });

  /** Marks an announcement read for this person only. */
  app.post('/api/announcements/read', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const body = (request.body ?? {}) as { id?: string };

    const open = body.id
      ? await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.id, body.id))
      : await db.select({ id: announcements.id }).from(announcements).where(isNotNull(announcements.publishedAt));

    if (open.length > 0) {
      await db
        .insert(announcementReads)
        .values(open.map((row) => ({ announcementId: row.id, userId: session.user.id })))
        // Reading twice is not an error.
        .onConflictDoNothing();
    }

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'announcement.read',
      resource: String('What is new'),
    });

    return reply.code(204).send();
  });

  /** Marks one as read, or everything when no id is given. */
  app.post('/api/notifications/read', async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));

    const body = (request.body ?? {}) as { id?: string };

    const scope = and(
      eq(notifications.organizationId, session.organization.id),
      or(isNull(notifications.userId), eq(notifications.userId, session.user.id)),
      isNull(notifications.readAt),
    );

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(body.id ? and(scope, eq(notifications.id, body.id)) : scope);

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'notification.read',
      resource: String('The bell'),
    });

    return reply.code(204).send();
  });
}
