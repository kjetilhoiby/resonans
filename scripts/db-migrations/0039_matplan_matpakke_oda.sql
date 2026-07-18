-- Matplan DEL B: matpakke-modul (profiler, komponenter, historikk, retur-logg)
-- og strukturerte Oda-ordrer/kvitteringer fra e-post.

CREATE TABLE IF NOT EXISTS lunchbox_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  likes text[] NOT NULL DEFAULT '{}',
  dislikes text[] NOT NULL DEFAULT '{}',
  allergies text[] NOT NULL DEFAULT '{}',
  appetite text NOT NULL DEFAULT 'middels',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lunchbox_profiles_user_person_idx
  ON lunchbox_profiles (user_id, person_id);

CREATE TABLE IF NOT EXISTS lunchbox_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lunchbox_components_user_name_idx
  ON lunchbox_components (user_id, lower(name));
CREATE INDEX IF NOT EXISTS lunchbox_components_user_kind_idx
  ON lunchbox_components (user_id, kind, active);

CREATE TABLE IF NOT EXISTS lunchbox_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  date date NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'suggested',
  packed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lunchbox_entries_user_person_date_idx
  ON lunchbox_entries (user_id, person_id, date);
CREATE INDEX IF NOT EXISTS lunchbox_entries_user_date_idx
  ON lunchbox_entries (user_id, date);

CREATE TABLE IF NOT EXISTS lunchbox_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  date date NOT NULL,
  entry_id uuid REFERENCES lunchbox_entries(id) ON DELETE SET NULL,
  component_id uuid REFERENCES lunchbox_components(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer,
  degree text NOT NULL DEFAULT 'noe',
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lunchbox_returns_user_person_date_idx
  ON lunchbox_returns (user_id, person_id, date);
CREATE INDEX IF NOT EXISTS lunchbox_returns_component_idx
  ON lunchbox_returns (component_id, date);

CREATE TABLE IF NOT EXISTS grocery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'oda',
  order_ref text,
  kind text NOT NULL DEFAULT 'receipt',
  order_date date,
  delivery_date date,
  week_context text NOT NULL,
  total_amount decimal,
  currency text NOT NULL DEFAULT 'NOK',
  gmail_message_id text,
  email_subject text,
  shopping_list_id uuid REFERENCES shopping_lists(id) ON DELETE SET NULL,
  pantry_applied_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS grocery_orders_user_gmail_idx
  ON grocery_orders (user_id, gmail_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_orders_user_provider_ref_idx
  ON grocery_orders (user_id, provider, order_ref);
CREATE INDEX IF NOT EXISTS grocery_orders_user_week_idx
  ON grocery_orders (user_id, week_context);

CREATE TABLE IF NOT EXISTS grocery_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES grocery_orders(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity decimal,
  unit text,
  unit_price decimal,
  total_price decimal,
  category text NOT NULL DEFAULT 'annet',
  pantry_location_guess text,
  pantry_item_id uuid REFERENCES pantry_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grocery_order_lines_order_idx
  ON grocery_order_lines (order_id);
