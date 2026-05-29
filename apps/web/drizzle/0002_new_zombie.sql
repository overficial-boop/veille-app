ALTER TABLE "dossiers" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dossiers_owner_slug_idx" ON "dossiers" USING btree ("owner_id","slug");