-- Safe migration: Create classification_overrides table if it doesn't exist
-- This can be run against production database without breaking existing data

CREATE TABLE IF NOT EXISTS "classification_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"fingerprint" text NOT NULL,
	"corrected_category" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'manual_ui' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'classification_overrides_user_id_users_id_fk'
    ) THEN
        ALTER TABLE "classification_overrides"
            ADD CONSTRAINT "classification_overrides_user_id_users_id_fk"
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") 
            ON DELETE no action ON UPDATE no action;
    END IF;
END $$;

-- Create unique index if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "classification_overrides_user_id_domain_fingerprint_unique"
	ON "classification_overrides" ("user_id", "domain", "fingerprint");

-- Create lookup index if it doesn't exist
CREATE INDEX IF NOT EXISTS "classification_overrides_user_domain_idx"
	ON "classification_overrides" ("user_id", "domain");
