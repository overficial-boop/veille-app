CREATE TABLE IF NOT EXISTS "dossier_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dossier_id" uuid NOT NULL,
	"body" text NOT NULL,
	"fact_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "brief_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "source_notes" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dossier_updates" ADD CONSTRAINT "dossier_updates_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
