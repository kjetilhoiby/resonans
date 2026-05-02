-- Add filter_subcategory column to user_widgets for two-level category filtering
ALTER TABLE "user_widgets" ADD COLUMN IF NOT EXISTS "filter_subcategory" text;
