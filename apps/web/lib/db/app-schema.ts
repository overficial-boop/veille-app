import { pgTable, text, timestamp, jsonb, real, uuid, uniqueIndex, integer, boolean } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export const dossiers = pgTable('dossiers', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  intent: text('intent').notNull(),
  language: text('language'),
  template: text('template').notNull().default('feed'), // 'profile' | 'chronology' | 'feed'
  cadence: jsonb('cadence'), // planner-suggested rhythm; NOT acted on in M1
  status: text('status').notNull().default('active'),
  slug: text('slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
  brief: text('brief'),
  briefGeneratedAt: timestamp('brief_generated_at', { withTimezone: true }),
  briefSuggestionDismissedAt: timestamp('brief_suggestion_dismissed_at', { withTimezone: true }),
  autoBrief: boolean('auto_brief').notNull().default(false),
  sourceNotes: jsonb('source_notes').$type<Record<string, string>>(),
}, (t) => [uniqueIndex('dossiers_owner_slug_idx').on(t.ownerId, t.slug)]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id')
    .notNull()
    .references(() => dossiers.id, { onDelete: 'cascade' }),
  connector: text('connector').notNull(), // youtube|web|text|pdf|tavily|rss|youtube-channel
  kind: text('kind').notNull(), // 'standing' | 'item'
  input: jsonb('input').$type<{ url?: string; query?: string; feedUrl?: string; source?: string }>().notNull(),
  label: text('label'),
  lastExtractedAt: timestamp('last_extracted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dossierUpdates = pgTable('dossier_updates', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  kind: text('kind').notNull().default('actualite'), // 'actualite' | 'complement'
  factCount: integer('fact_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  siteName: text('site_name'),                 // host, or YouTube channel name
  kind: text('kind').notNull().default('web'), // 'web' | 'youtube'
  publishedAt: timestamp('published_at', { withTimezone: true }),
  content: text('content'),                    // extracted page/transcript text, kept for on-demand review generation
  status: text('status').notNull().default('kept'),       // 'kept' | 'suggestion' | 'rejected'
  relevance: real('relevance'),                            // 0..1 vs the dossier intent (null if unscored)
  relevanceReason: text('relevance_reason'),
  shortSummary: text('short_summary'),
  review: jsonb('review'),
  bullets: jsonb('bullets'),
  elaboration: jsonb('elaboration'),
  factChecks: jsonb('fact_checks'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('documents_dossier_url_idx').on(t.dossierId, t.url)]);

export const facts = pgTable('facts', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id')
    .notNull()
    .references(() => dossiers.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .references(() => sources.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  sourceUrl: text('source_url').notNull(),
  text: text('text').notNull(),
  sourcePassage: text('source_passage').notNull(),
  language: text('language').notNull(),
  provenance: jsonb('provenance').notNull(),
  extractedBy: jsonb('extracted_by').notNull(),
  confidence: real('confidence'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
