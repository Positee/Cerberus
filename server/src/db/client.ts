import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Neon terminates idle connections and sleeps the compute after five minutes.
 * A small pool with a short idle timeout suits that better than a large one.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: 'require',
});

export const db = drizzle(sql, { schema });

export type Db = typeof db;
