import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Next, so load .env.local ourselves (Node 22).
try {
  process.loadEnvFile('.env.local');
} catch {
  // optional — DATABASE_URL may already be exported in the environment
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
