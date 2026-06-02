ALTER TABLE "facts" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status" text DEFAULT 'kept' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "relevance" real;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "relevance_reason" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "auto_brief" boolean DEFAULT false NOT NULL;