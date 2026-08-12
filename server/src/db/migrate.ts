import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

/** Applies every file in server/drizzle. Safe to run more than once. */
async function main() {
  console.log('Applying migrations.');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  await sql.end();
}

main().catch(async (error) => {
  console.error('Migration failed.');
  console.error(error);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
