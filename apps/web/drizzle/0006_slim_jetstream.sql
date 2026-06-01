CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dossier_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"site_name" text,
	"kind" text DEFAULT 'web' NOT NULL,
	"published_at" timestamp with time zone,
	"short_summary" text,
	"review" jsonb,
	"bullets" jsonb,
	"elaboration" jsonb,
	"fact_checks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_dossier_url_idx" ON "documents" USING btree ("dossier_id","url");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts" ADD CONSTRAINT "facts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
