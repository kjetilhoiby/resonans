-- Matplan DEL A: handlelister per uke + updated_at på meal_plans.
-- Handlelisten er et strukturert artefakt (ikke checklist-items) slik at varer
-- har normalisert navn for Oda-søkelenker og senere kvitteringsmatching.

CREATE TABLE IF NOT EXISTS shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_context text NOT NULL,
  kind text NOT NULL DEFAULT 'week',
  status text NOT NULL DEFAULT 'draft',
  items jsonb NOT NULL DEFAULT '[]',
  meta jsonb NOT NULL DEFAULT '{}',
  generated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_lists_user_week_kind_idx
  ON shopping_lists (user_id, week_context, kind);

ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS meal_plans_user_meal_idx ON meal_plans (user_id, meal_id);
