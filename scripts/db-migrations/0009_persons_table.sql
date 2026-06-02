-- Personer i brukerens nettverk (`persons`) + de tre array-kolonnene og
-- `archived`. Tabellen og kolonnene har ligget i schema.ts uten en eksplisitt
-- SQL-migrasjon og har vært avhengig av `drizzle-kit push`. Push har historisk
-- skippet additive kolonner stille (jf. Ekko v1.1 / PR #89), så `spond_group_ids`,
-- `email_addresses`, `aliases` og `archived` kan mangle i prod selv om selve
-- tabellen finnes. Det gir 500 på `/api/sensors/spond/groups` (SELECT * fra
-- persons + filter på archived) → personkortet viser "kunne ikke hente
-- Spond-grupper". Denne migrasjonen sikrer hele måltilstanden idempotent.

CREATE TABLE IF NOT EXISTS persons (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	full_name text,
	nickname text,
	birth_date date,
	kind text NOT NULL DEFAULT 'other',
	avatar_emoji text,
	photo_url text,
	notes text,
	spond_group_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
	email_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
	aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
	archived boolean NOT NULL DEFAULT false,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

-- Additive kolonner — for tilfellet der tabellen allerede ble opprettet av en
-- tidligere drizzle push uten disse.
ALTER TABLE persons ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other';
ALTER TABLE persons ADD COLUMN IF NOT EXISTS avatar_emoji text;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS spond_group_ids text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE persons ADD COLUMN IF NOT EXISTS email_addresses text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE persons ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE persons ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
ALTER TABLE persons ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS persons_user_kind_idx ON persons (user_id, kind);
CREATE INDEX IF NOT EXISTS persons_user_active_idx ON persons (user_id, archived);
