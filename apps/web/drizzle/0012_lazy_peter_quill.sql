ALTER TABLE "facts" ADD COLUMN "journal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "journal_reason" text;