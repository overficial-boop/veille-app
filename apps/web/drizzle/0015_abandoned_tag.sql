CREATE TABLE IF NOT EXISTS "block_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dossier_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"scope" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "block_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"target_key" text DEFAULT 'page' NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "block_instances" ADD CONSTRAINT "block_instances_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "block_outputs" ADD CONSTRAINT "block_outputs_instance_id_block_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."block_instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "block_instances_dossier_block_scope_idx" ON "block_instances" USING btree ("dossier_id","block_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "block_outputs_instance_target_idx" ON "block_outputs" USING btree ("instance_id","target_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "block_outputs_instance_idx" ON "block_outputs" USING btree ("instance_id");