-- Kapplister: materialkalkulator knyttet til et prosjekt (tema).
-- Hver kappliste har rader med {dimensjon, lengde, antall, meterpris} i en JSONB-array.

CREATE TABLE IF NOT EXISTS cut_lists (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	title text NOT NULL DEFAULT 'Kappliste',
	board_length_cm integer NOT NULL DEFAULT 390,
	kerf_mm integer NOT NULL DEFAULT 0,
	rows jsonb NOT NULL DEFAULT '[]'::jsonb,
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cut_lists_theme_idx ON cut_lists (theme_id);
CREATE INDEX IF NOT EXISTS cut_lists_user_idx ON cut_lists (user_id);
