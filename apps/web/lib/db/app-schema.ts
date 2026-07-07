import { pgTable, text, timestamp, jsonb, real, uuid, uniqueIndex, index, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  // Numbered article references the brief cites with [n] tags (provenance: maps n → the exact article).
  briefRefs: jsonb('brief_refs').$type<{ n: number; url: string; docId: string | null; title: string; host: string }[]>(),
}, (t) => [uniqueIndex('dossiers_owner_slug_idx').on(t.ownerId, t.slug)]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id')
    .notNull()
    .references(() => dossiers.id, { onDelete: 'cascade' }),
  connector: text('connector').notNull(), // youtube|web|text|pdf|tavily|rss|youtube-channel
  kind: text('kind').notNull(), // 'standing' | 'item'
  purpose: text('purpose').notNull().default('state'), // 'state' (corpus, assemble) | 'watch' (recent, refresh)
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

export const refreshRuns = pgTable('refresh_runs', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  params: jsonb('params').$type<{ recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number }>().notNull(),
  counts: jsonb('counts').$type<{ raw: number; kept: number; suggestion: number; rejected: number }>().notNull(),
  funnel: jsonb('funnel').notNull(),
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
  // Journal: set when a fact is promoted to the "what's new" feed by the refresh novelty gate.
  journalAt: timestamp('journal_at', { withTimezone: true }),
  journalReason: text('journal_reason'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

import type { JobType, JobStatus, JobParams, JobProgress } from '../jobs/policy';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  type: text('type').$type<JobType>().notNull(),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  params: jsonb('params').$type<JobParams>().notNull(),
  progress: jsonb('progress').$type<JobProgress>(),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('jobs_status_created_idx').on(t.status, t.createdAt),
  index('jobs_dossier_idx').on(t.dossierId),
  // At most ONE active (queued|running) job per dossier — enforced by the DB.
  uniqueIndex('jobs_one_active_per_dossier_idx').on(t.dossierId).where(sql`status in ('queued','running')`),
]);

export const blockInstances = pgTable('block_instances', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  blockId: text('block_id').notNull(),           // registry id — definitions live in code
  scope: text('scope').$type<'page' | 'item'>().notNull(),
  position: integer('position').notNull().default(0), // page-stack order; item blocks ignore it
  config: jsonb('config').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One instance of a block per dossier per scope (re-attach = no-op).
  uniqueIndex('block_instances_dossier_block_scope_idx').on(t.dossierId, t.blockId, t.scope),
]);

export const blockOutputs = pgTable('block_outputs', {
  id: uuid('id').primaryKey(),
  instanceId: uuid('instance_id').notNull().references(() => blockInstances.id, { onDelete: 'cascade' }),
  targetKey: text('target_key').notNull().default('page'), // 'page' | a documents.id (item scope)
  content: text('content').notNull(),                      // markdown
  citations: jsonb('citations').$type<{ factId?: string; url: string }[]>().notNull(),
  fingerprint: text('fingerprint').notNull(),              // combined prerequisite fingerprint at generation time
  stale: boolean('stale').notNull().default(false),        // set by refresh; cleared on regeneration
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('block_outputs_instance_target_idx').on(t.instanceId, t.targetKey),
  index('block_outputs_instance_idx').on(t.instanceId),
]);
