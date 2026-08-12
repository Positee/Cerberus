import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import authRoutes from './auth/routes.js';
import { purgeExpiredSessions } from './auth/session.js';
import { sql } from './db/client.js';
import { env, isProduction } from './env.js';

const app = Fastify({
  logger: isProduction ? true : { transport: { target: 'pino-pretty' } },
  trustProxy: true,
});

await app.register(cookie);

// Vite proxies /api in development, so this is same origin and CORS is unused.
// It stays registered for the case where the API is served from another host.
await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

app.get('/api/health', async () => {
  await sql`select 1`;
  return { status: 'ok', time: new Date().toISOString() };
});

await app.register(authRoutes);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.code(500).send({ error: { code: 'server_error', message: 'Something failed. Try again.' } });
});

async function start() {
  try {
    const removed = await purgeExpiredSessions();
    if (removed > 0) app.log.info(`Removed ${removed} expired sessions.`);

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info('Shutting down.');
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await start();
