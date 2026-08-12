import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// `generate` only reads the schema file, so it works with no database. The
// commands that do connect fail with their own message when the URL is empty.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
