-- Add snooze + skip tracking to checklist_items.
-- skipped_at: set when user marks an item as "won't do" (renders as strikethrough + ✕).
-- snoozed_to_date: when user snoozed the item, the date the copy lives on (original stays as skipped).
ALTER TABLE "checklist_items"
  ADD COLUMN IF NOT EXISTS "skipped_at" timestamp,
  ADD COLUMN IF NOT EXISTS "snoozed_to_date" date;
