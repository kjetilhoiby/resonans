-- Matplan-utvidelser: matinnstillinger (ukebudsjett for dagligvarer) og
-- faste varer (staples) i lageret — frukt/grønt/nøtter som alltid skal finnes.

CREATE TABLE IF NOT EXISTS food_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grocery_budget_weekly decimal,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS is_staple boolean NOT NULL DEFAULT false;
