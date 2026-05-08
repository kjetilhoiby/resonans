-- Add theme_id to user_widgets for theme-scoped configurable widgets.
-- NULL = home screen widget. Set = belongs to that theme's dashboard.
ALTER TABLE "user_widgets"
  ADD COLUMN IF NOT EXISTS "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "user_widgets_theme_idx"
  ON "user_widgets" ("user_id", "theme_id", "sort_order");
