import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyError } from 'fastify';
import authRoutes from './auth/routes.js';
import profileRoutes from './profile/routes.js';
import workspaceRoutes from './workspace/routes.js';
import invitationRoutes, { purgeExpiredInvitations } from './workspace/invitations.js';
import alertingRoutes from './alerting/routes.js';
import taskRoutes from './tasks/routes.js';
import scheduleRoutes from './schedules/routes.js';
import notificationRoutes from './notifications/routes.js';
import { startRunner } from './schedules/runner.js';
import { purgeExpiredSessions } from './auth/session.js';
import { sql } from './db/client.js';
import { fail } from './http/errors.js';
import { env, isProduction } from './env.js';
import { AVATAR_TYPES } from '../../shared/api.js';

const app = Fastify({
  logger: isProduction ? true : { transport: { target: 'pino-pretty' } },
  trustProxy: true,
});

await app.register(cookie);

// Vite proxies /api in development, so this is same origin and CORS is unused.
// It stays registered for the case where the API is served from another host.
await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

/**
 * The error handlers come before every route.
 *
 * A plugin takes a copy of these when it is registered, so setting them later
 * would leave the routes on the Fastify defaults and send the browser a shape
 * it cannot read.
 */
app.setErrorHandler((error: FastifyError, request, reply) => {
  const status = error.statusCode ?? 500;

  // A body that breaks a limit or a parser is the caller's problem. Reporting
  // it as 500 would send the browser looking for a fault in the API.
  if (status === 413) {
    request.log.info({ err: error }, 'Body too large.');
    return reply.code(413).send(fail('invalid_request', 'That file is too large.'));
  }

  if (status === 415) {
    request.log.info({ err: error }, 'Unsupported media type.');
    return reply.code(415).send(fail('invalid_request', 'Cerberus cannot read that file type.'));
  }

  if (status >= 400 && status < 500) {
    request.log.info({ err: error }, 'Client error.');
    return reply.code(status).send(fail('invalid_request', error.message));
  }

  app.log.error(error);
  return reply.code(500).send(fail('server_error', 'Something failed. Try again.'));
});

app.setNotFoundHandler((request, reply) => {
  return reply.code(404).send(fail('not_found', `No route answers ${request.method} ${request.url}.`));
});

// A profile picture arrives as raw image bytes, already cropped by the
// browser. Reading it as a buffer keeps the API free of an upload library.
app.addContentTypeParser([...AVATAR_TYPES], { parseAs: 'buffer' }, (_request, body, done) => {
  done(null, body);
});

app.get('/api/health', async () => {
  await sql`select 1`;
  return { status: 'ok', time: new Date().toISOString() };
});

await app.register(authRoutes);
await app.register(profileRoutes);
await app.register(workspaceRoutes);
await app.register(invitationRoutes);
await app.register(alertingRoutes);
await app.register(taskRoutes);
await app.register(scheduleRoutes);
await app.register(notificationRoutes);

let stopRunner: (() => void) | null = null;

async function start() {
  try {
    const removed = await purgeExpiredSessions();
    if (removed > 0) app.log.info(`Removed ${removed} expired sessions.`);

    const stale = await purgeExpiredInvitations();
    if (stale > 0) app.log.info(`Removed ${stale} expired invitations.`);

    stopRunner = startRunner(app.log);
    app.log.info('Schedule runner started.');

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info('Shutting down.');
    stopRunner?.();
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await start();
