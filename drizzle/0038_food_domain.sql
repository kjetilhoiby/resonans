-- Food domain: recipes, meal plans, pantry items
-- Mirrors src/lib/db/schema.ts definitions for recipes, mealPlans, pantryItems.

CREATE TABLE IF NOT EXISTS recipes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
    instructions text[] NOT NULL DEFAULT ARRAY[]::text[],
    prep_time_min integer,
    cook_time_min integer,
    servings integer NOT NULL DEFAULT 2,
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    image_url text,
    source_url text,
    nutrition_estimate jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_user_idx
    ON recipes (user_id, created_at);

CREATE TABLE IF NOT EXISTS meal_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_context text NOT NULL,
    date date NOT NULL,
    meal_type text NOT NULL,
    recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
    custom_title text,
    notes text,
    servings integer NOT NULL DEFAULT 2,
    photo_url text,
    created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_plans_user_week_idx
    ON meal_plans (user_id, week_context);

CREATE INDEX IF NOT EXISTS meal_plans_user_date_idx
    ON meal_plans (user_id, date);

CREATE TABLE IF NOT EXISTS pantry_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    location text NOT NULL,
    quantity numeric,
    unit text,
    expires_at date,
    added_at timestamp NOT NULL DEFAULT now(),
    last_used_at timestamp,
    notes text
);

CREATE INDEX IF NOT EXISTS pantry_items_user_location_idx
    ON pantry_items (user_id, location);

CREATE INDEX IF NOT EXISTS pantry_items_user_expires_idx
    ON pantry_items (user_id, expires_at);
