import { and, asc, count, desc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  conversations,
  conversationParticipants,
  messages,
  users,
  memberships,
} from '../db/schema.js';
import { readSession } from '../auth/session.js';
import { record } from '../audit/record.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload } from '../../../shared/api.js';
import { can, type Permission } from '../../../shared/permissions.js';
import type {
  Conversation,
  ConversationSummary,
  Message,
  MessageWithSender,
} from '../../../shared/inbox.js';

/**
 * Inbox.
 *
 * Direct messages between team members. Each conversation belongs to exactly
 * two people in the same organization. There is at most one conversation per
 * pair.
 */

const publicUserCols = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  avatarUpdatedAt: users.avatarUpdatedAt,
} as const;

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

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    replyToId: row.replyToId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

export function participantInWorkspaceQuery(conversationId: string, userId: string, organizationId: string) {
  return db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
        eq(conversations.organizationId, organizationId),
      ),
    )
    .limit(1);
}

export function inboxConversationListQuery(userId: string, organizationId: string) {
  return db
    .select({
      conversationId: conversationParticipants.conversationId,
      lastReadAt: conversationParticipants.lastReadAt,
      organizationId: conversations.organizationId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(
      and(
        eq(conversationParticipants.userId, userId),
        eq(conversations.organizationId, organizationId),
      ),
    );
}

async function participantInWorkspace(conversationId: string, userId: string, organizationId: string) {
  const [participant] = await participantInWorkspaceQuery(conversationId, userId, organizationId);

  return participant ?? null;
}

export default async function inboxRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------- conversations -- */

  /** List all conversations for the current user, with the other person's info and last message. */
  app.get('/api/inbox/conversations', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    // A user can belong to several workspaces. Only the active workspace is visible.
    const myParts = await inboxConversationListQuery(session.user.id, session.organization.id);

    const convIds = myParts.map((p) => p.conversationId);
    if (convIds.length === 0) return reply.send({ conversations: [] });

    // Get the other participant for each conversation.
    const otherParts = await db
      .select({
        conversationId: conversationParticipants.conversationId,
        userId: conversationParticipants.userId,
        user: publicUserCols,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(
        and(
          inArray(conversationParticipants.conversationId, convIds),
          ne(conversationParticipants.userId, session.user.id),
        ),
      );

    const otherByConv = new Map(otherParts.map((p) => [p.conversationId, {
      ...p.user,
      avatarUpdatedAt: p.user.avatarUpdatedAt?.toISOString() ?? null,
    }]));

    // Get last message for each conversation.
    const lastMsgs = await db
      .select({
        conversationId: messages.conversationId,
        body: messages.body,
        senderId: messages.senderId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(desc(messages.createdAt));

    // Deduplicate to keep only the first (most recent) per conversation.
    type LastMsg = typeof lastMsgs[number];
    const lastMsgByConv = new Map<string, LastMsg>();
    for (const m of lastMsgs) {
      if (!lastMsgByConv.has(m.conversationId)) lastMsgByConv.set(m.conversationId, m);
    }

    // Compute unread counts.
    const myPartMap = new Map(myParts.map((p) => [p.conversationId, p.lastReadAt]));
    const summaries: ConversationSummary[] = [];

    for (const part of myParts) {
      const convId = part.conversationId;
      const other = otherByConv.get(convId);
      if (!other) continue;

      const lastMsg = lastMsgByConv.get(convId) ?? null;
      const lastRead = myPartMap.get(convId);

      // Count messages after lastRead.
      let unread = 0;
      if (lastRead) {
        const [uc] = await db
          .select({ n: count(messages.id) })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, convId),
              ne(messages.senderId, session.user.id),
              gt(messages.createdAt, lastRead),
            ),
          );
        unread = uc?.n ?? 0;
      } else {
        // Never read: count all messages from the other person.
        const [uc] = await db
          .select({ n: count(messages.id) })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, convId),
              ne(messages.senderId, session.user.id),
            ),
          );
        unread = uc?.n ?? 0;
      }

      summaries.push({
        id: convId,
        organizationId: part.organizationId,
        createdAt: part.createdAt.toISOString(),
        updatedAt: part.updatedAt.toISOString(),
        otherUser: other,
        lastMessage: lastMsg
          ? { body: lastMsg.body, senderId: lastMsg.senderId, createdAt: lastMsg.createdAt.toISOString() }
          : null,
        unreadCount: unread,
      });
    }

    // Sort by most recently updated.
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return reply.send({ conversations: summaries });
  });

  /** Create or find a conversation with another user. */
  app.post('/api/inbox/conversations', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const schema = z.object({ userId: z.string().uuid() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Provide a user ID.', fieldErrors(parsed.error)));
    }

    const { userId } = parsed.data;
    if (userId === session.user.id) {
      return reply.code(400).send(fail('invalid_request', 'You cannot message yourself.'));
    }

    // Verify the target is in the same organization.
    const [targetMember] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, session.organization.id),
        ),
      )
      .limit(1);

    if (!targetMember) {
      return reply.code(404).send(fail('not_found', 'That person is not in this workspace.'));
    }

    // Check for an existing conversation between these two users.
    const myConvs = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(
        and(
          eq(conversationParticipants.userId, session.user.id),
          eq(conversations.organizationId, session.organization.id),
        ),
      );

    const myConvIds = myConvs.map((c) => c.conversationId);

    if (myConvIds.length > 0) {
      const existing = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(
          and(
            inArray(conversationParticipants.conversationId, myConvIds),
            eq(conversationParticipants.userId, userId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Return the existing conversation.
        const existingConvId = existing[0]!.conversationId;
        const [conv] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, existingConvId),
              eq(conversations.organizationId, session.organization.id),
            ),
          )
          .limit(1);
        if (conv) {
          return reply.send({
            conversation: {
              ...conv,
              createdAt: conv.createdAt.toISOString(),
              updatedAt: conv.updatedAt.toISOString(),
            },
          });
        }
      }
    }

    // Create a new conversation.
    const now = new Date();
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: session.organization.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Add both participants.
    await db.insert(conversationParticipants).values([
      { conversationId: conv!.id, userId: session.user.id },
      { conversationId: conv!.id, userId },
    ]);

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'inbox.conversation.create',
      resource: String('Conversation'),
    });

    return reply.code(201).send({
      conversation: {
        ...conv!,
        createdAt: conv!.createdAt.toISOString(),
        updatedAt: conv!.updatedAt.toISOString(),
      },
    });
  });

  /* ------------------------------------------------------------ messages -- */

  /** List messages in a conversation. */
  app.get('/api/inbox/conversations/:id/messages', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; before?: string };

    const part = await participantInWorkspace(id, session.user.id, session.organization.id);

    if (!part) return reply.code(404).send(fail('not_found', 'Conversation not found.'));

    const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 200);

    let where = eq(messages.conversationId, id);
    if (query.before) {
      const beforeDate = new Date(query.before);
      if (!isNaN(beforeDate.getTime())) {
        where = and(where, lt(messages.createdAt, beforeDate)) as typeof where;
      }
    }

    const rows = await db
      .select({
        msg: messages,
        sender: publicUserCols,
      })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(where)
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    // Fetch sender info for each message.
    const result: MessageWithSender[] = rows.reverse().map((row) => ({
      ...toMessage(row.msg),
      sender: {
        ...row.sender,
        avatarUpdatedAt: row.sender.avatarUpdatedAt?.toISOString() ?? null,
      },
    }));

    return reply.send({ messages: result });
  });

  /** Send a message in a conversation. */
  app.post('/api/inbox/conversations/:id/messages', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const { id } = request.params as { id: string };

    const schema = z.object({
      body: z.string().trim().min(1, 'Write a message.').max(5000),
      replyToId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the message.', fieldErrors(parsed.error)));
    }

    const part = await participantInWorkspace(id, session.user.id, session.organization.id);

    if (!part) return reply.code(404).send(fail('not_found', 'Conversation not found.'));

    // If replying, verify the parent message exists in this conversation.
    if (parsed.data.replyToId) {
      const [parent] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.id, parsed.data.replyToId),
            eq(messages.conversationId, id),
          ),
        )
        .limit(1);

      if (!parent) {
        return reply.code(400).send(fail('invalid_request', 'The message to reply to was not found.'));
      }
    }

    const [msg] = await db
      .insert(messages)
      .values({
        conversationId: id,
        senderId: session.user.id,
        body: parsed.data.body,
        replyToId: parsed.data.replyToId ?? null,
      })
      .returning();

    // Touch the conversation's updated_at for sorting.
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.organizationId, session.organization.id)));

    // Fetch the sender info.
    const [sender] = await db
      .select(publicUserCols)
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'inbox.message.send',
      resource: String('Conversation ' + id),
    });

    return reply.code(201).send({
      message: {
        ...toMessage(msg!),
        sender: sender ? {
          ...sender,
          avatarUpdatedAt: sender.avatarUpdatedAt?.toISOString() ?? null,
        } : { id: session.user.id, fullName: '', email: '', avatarUpdatedAt: null },
      },
    });
  });

  /** Mark a conversation as read for the current user. */
  app.post('/api/inbox/conversations/:id/read', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    const part = await participantInWorkspace(id, session.user.id, session.organization.id);
    if (!part) return reply.code(404).send(fail('not_found', 'Conversation not found.'));

    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, id),
          eq(conversationParticipants.userId, session.user.id),
        ),
      );

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'inbox.conversation.read',
      resource: String('Conversation ' + id),
    });

    return reply.code(204).send();
  });

  /** List workspace members available for messaging. */
  app.get('/api/inbox/members', async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!(await allow(reply, session, 'workspace.view'))) return;

    const rows = await db
      .select({
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        avatarUpdatedAt: users.avatarUpdatedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.organizationId, session.organization.id))
      .orderBy(asc(users.fullName));

    // Exclude self.
    const members = rows.filter((r) => r.userId !== session.user.id);

    return reply.send({ members });
  });
}
