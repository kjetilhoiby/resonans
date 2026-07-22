-- Funn — triage-innboks for lagrede lenker/reels (Instagram m.m.)
-- Kommer inn via e-post (email_rules.processing_type = 'find_triage'), GPT
-- klassifiserer innholdet, og funnet lander her for triage. Oppskrifter
-- promoteres til meals (meal_id peker dit).

CREATE TABLE IF NOT EXISTS finds (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title text NOT NULL,
	summary text,
	theme text,
	kind text,
	source_url text,
	thumbnail_url text,
	raw_text text,
	extracted jsonb,
	status text NOT NULL DEFAULT 'inbox',
	meal_id uuid REFERENCES meals(id) ON DELETE SET NULL,
	email_from text,
	email_subject text,
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS finds_user_status_idx ON finds (user_id, status, created_at);
