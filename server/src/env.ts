import 'dotenv/config';
import { z } from 'zod';

/** Fail at boot with a clear message, not on the first query with a stack trace. */
const schema = z.object({
  // Treat an unset variable and an empty one the same, so both get the
  // instruction instead of a type error.
  DATABASE_URL: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'DATABASE_URL is missing. Copy server/.env.example to server/.env and paste your Neon string.'),
  ),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  console.error(`Cerberus API cannot start. Check server/.env\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
