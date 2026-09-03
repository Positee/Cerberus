import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { record, recordDenied } from '../audit/record.js';
import { readSession } from '../auth/session.js';
import { db } from '../db/client.js';
import { knowledgeProgress, knowledgeResources } from '../db/schema.js';
import { fail, fieldErrors } from '../http/errors.js';
import type { SessionPayload } from '../../../shared/api.js';
import {
  BUILT_IN_LESSON_KEYS,
  youtubeVideoId,
  type KnowledgePayload,
  type KnowledgeResource,
} from '../../../shared/knowledge.js';
import { can } from '../../../shared/permissions.js';

const topicValues = ['foundations', 'networking', 'identity', 'defense'] as const;
const typeValues = ['article', 'video'] as const;

const resourceSchema = z
  .object({
    topic: z.enum(topicValues),
    type: z.enum(typeValues),
    title: z.string().trim().min(3, 'Enter a longer title.').max(140),
    summary: z.string().trim().min(10, 'Enter a short summary.').max(280),
    body: z.string().trim().max(20_000).optional().default(''),
    sourceUrl: z.string().trim().max(2_000).optional().default(''),
    durationMinutes: z.number().int().min(1).max(600),
    published: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.type === 'video' && !youtubeVideoId(value.sourceUrl)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'Enter a valid YouTube video link.',
      });
    }

    if (value.type === 'article' && value.body.length < 20) {
      context.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'Write at least 20 characters.',
      });
    }
  });

const progressSchema = z.object({ completed: z.boolean() });

function canPublish(session: SessionPayload): boolean {
  return can('knowledge.manage', {
    role: session.role,
    kind: session.organization.kind,
    policy: session.organization.policy,
  });
}

async function requirePersonal(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionPayload | null> {
  const session = await readSession(request);
  if (!session) {
    await reply.code(401).send(fail('unauthorized', 'Sign in to continue.'));
    return null;
  }

  if (session.organization.kind !== 'personal') {
    await reply.code(403).send(fail('unauthorized', 'The knowledge base belongs to personal accounts.'));
    return null;
  }

  return session;
}

async function requirePublisher(
  request: FastifyRequest,
  reply: FastifyReply,
  session: SessionPayload,
): Promise<boolean> {
  if (canPublish(session)) return true;

  recordDenied(request, {
    organizationId: session.organization.id,
    actorUserId: session.user.id,
    actor: session.user.email,
    action: 'permission.denied',
    resource: 'knowledge.manage',
  });
  await reply.code(403).send(fail('unauthorized', 'Your role does not allow that.'));
  return false;
}

function toResource(row: typeof knowledgeResources.$inferSelect): KnowledgeResource {
  return {
    id: row.id,
    topic: row.topic,
    title: row.title,
    summary: row.summary,
    type: row.type,
    body: row.body,
    sourceUrl: row.sourceUrl,
    videoId: row.sourceUrl ? youtubeVideoId(row.sourceUrl) : null,
    durationMinutes: row.durationMinutes,
    published: row.published,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function knowledgeResourceListQuery(organizationId: string, includeDrafts: boolean) {
  return db
    .select()
    .from(knowledgeResources)
    .where(
      includeDrafts
        ? eq(knowledgeResources.organizationId, organizationId)
        : and(eq(knowledgeResources.organizationId, organizationId), eq(knowledgeResources.published, true)),
    )
    .orderBy(asc(knowledgeResources.topic), asc(knowledgeResources.createdAt));
}

export default async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/knowledge', async (request, reply) => {
    const session = await requirePersonal(request, reply);
    if (!session) return;

    const editable = canPublish(session);
    const [resourceRows, progressRows] = await Promise.all([
      knowledgeResourceListQuery(session.organization.id, editable),
      db
        .select({ lessonKey: knowledgeProgress.lessonKey })
        .from(knowledgeProgress)
        .where(
          and(
            eq(knowledgeProgress.organizationId, session.organization.id),
            eq(knowledgeProgress.userId, session.user.id),
          ),
        ),
    ]);

    const payload: KnowledgePayload = {
      resources: resourceRows.map(toResource),
      completedLessonKeys: progressRows.map((row) => row.lessonKey),
      canPublish: editable,
    };
    return reply.send(payload);
  });

  app.post('/api/knowledge/resources', async (request, reply) => {
    const session = await requirePersonal(request, reply);
    if (!session) return;
    if (!(await requirePublisher(request, reply, session))) return;

    const parsed = resourceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the lesson.', fieldErrors(parsed.error)));
    }

    const value = parsed.data;
    const [created] = await db
      .insert(knowledgeResources)
      .values({
        organizationId: session.organization.id,
        createdBy: session.user.id,
        topic: value.topic,
        type: value.type,
        title: value.title,
        summary: value.summary,
        body: value.body,
        sourceUrl: value.sourceUrl || null,
        durationMinutes: value.durationMinutes,
        published: value.published,
      })
      .returning();

    if (!created) return reply.code(500).send(fail('server_error', 'The lesson was not written.'));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'knowledge.create',
      resource: created.title,
    });
    return reply.code(201).send(toResource(created));
  });

  app.put('/api/knowledge/resources/:id', async (request, reply) => {
    const session = await requirePersonal(request, reply);
    if (!session) return;
    if (!(await requirePublisher(request, reply, session))) return;

    const parsed = resourceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the lesson.', fieldErrors(parsed.error)));
    }

    const { id } = request.params as { id: string };
    const value = parsed.data;
    const [updated] = await db
      .update(knowledgeResources)
      .set({
        topic: value.topic,
        type: value.type,
        title: value.title,
        summary: value.summary,
        body: value.body,
        sourceUrl: value.sourceUrl || null,
        durationMinutes: value.durationMinutes,
        published: value.published,
        updatedAt: new Date(),
      })
      .where(
        and(eq(knowledgeResources.id, id), eq(knowledgeResources.organizationId, session.organization.id)),
      )
      .returning();

    if (!updated) return reply.code(404).send(fail('not_found', 'That lesson is gone.'));

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'knowledge.update',
      resource: updated.title,
    });
    return reply.send(toResource(updated));
  });

  app.delete('/api/knowledge/resources/:id', async (request, reply) => {
    const session = await requirePersonal(request, reply);
    if (!session) return;
    if (!(await requirePublisher(request, reply, session))) return;

    const { id } = request.params as { id: string };
    const [removed] = await db
      .delete(knowledgeResources)
      .where(
        and(eq(knowledgeResources.id, id), eq(knowledgeResources.organizationId, session.organization.id)),
      )
      .returning({ id: knowledgeResources.id, title: knowledgeResources.title });

    if (!removed) return reply.code(404).send(fail('not_found', 'That lesson is gone.'));

    await db
      .delete(knowledgeProgress)
      .where(
        and(
          eq(knowledgeProgress.organizationId, session.organization.id),
          eq(knowledgeProgress.lessonKey, `custom:${removed.id}`),
        ),
      );

    record(request, {
      organizationId: session.organization.id,
      actorUserId: session.user.id,
      actor: session.user.email,
      action: 'knowledge.delete',
      resource: removed.title,
    });
    return reply.code(204).send();
  });

  app.put('/api/knowledge/progress/:lessonKey', async (request, reply) => {
    const session = await requirePersonal(request, reply);
    if (!session) return;

    const parsed = progressSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail('invalid_request', 'Check the progress value.', fieldErrors(parsed.error)));
    }

    const { lessonKey } = request.params as { lessonKey: string };
    let lessonExists = BUILT_IN_LESSON_KEYS.has(lessonKey);

    if (!lessonExists && lessonKey.startsWith('custom:')) {
      const id = lessonKey.slice('custom:'.length);
      if (!z.string().uuid().safeParse(id).success) {
        return reply.code(404).send(fail('not_found', 'That lesson is gone.'));
      }
      const [resource] = await db
        .select({ id: knowledgeResources.id, published: knowledgeResources.published })
        .from(knowledgeResources)
        .where(
          and(eq(knowledgeResources.id, id), eq(knowledgeResources.organizationId, session.organization.id)),
        )
        .limit(1);
      lessonExists = Boolean(resource && (resource.published || canPublish(session)));
    }

    if (!lessonExists) return reply.code(404).send(fail('not_found', 'That lesson is gone.'));

    if (parsed.data.completed) {
      await db
        .insert(knowledgeProgress)
        .values({
          organizationId: session.organization.id,
          userId: session.user.id,
          lessonKey,
          completedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [knowledgeProgress.organizationId, knowledgeProgress.userId, knowledgeProgress.lessonKey],
          set: { completedAt: new Date() },
        });
    } else {
      await db
        .delete(knowledgeProgress)
        .where(
          and(
            eq(knowledgeProgress.organizationId, session.organization.id),
            eq(knowledgeProgress.userId, session.user.id),
            eq(knowledgeProgress.lessonKey, lessonKey),
          ),
        );
    }

    return reply.code(204).send();
  });
}
