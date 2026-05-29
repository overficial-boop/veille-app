import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().min(1),
  VEILLE_GEMINI_KEY: z.string().optional(),
  VEILLE_ANTHROPIC_KEY: z.string().optional(),
  VEILLE_TAVILY_KEY: z.string().optional(),
  SUPADATA_API_KEY: z.string().optional(),
});

// Server-only. Never import this from a client component.
export const env = schema.parse(process.env);
