-- Quiz-sesjoner for tale-assistenten (bilferie-quizmasteren).
-- Holder tracking per deltaker (poeng, streak, beste streak) så «on fire!»-kommentarer
-- blir korrekte over et langt spill i stedet for gjettet av modellen.
-- Én aktiv quiz per bruker (familien deler én enhet i bilen) — håndhevet av partial unique index.

CREATE TABLE IF NOT EXISTS quiz_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- [{ name, score, streak, bestStreak, asked, correct }]
	participants jsonb NOT NULL DEFAULT '[]'::jsonb,
	theme text,                                   -- temaet for inneværende runde
	round integer NOT NULL DEFAULT 0,             -- antall fullførte runder
	active boolean NOT NULL DEFAULT true,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_sessions_user_idx ON quiz_sessions (user_id);
-- Maks én aktiv quiz per bruker; en ny «start» deaktiverer den forrige først.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_sessions_active_user_uq ON quiz_sessions (user_id) WHERE active;
