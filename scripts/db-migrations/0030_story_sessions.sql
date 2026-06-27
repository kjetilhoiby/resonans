-- Interaktive fortellinger for tale-assistentens forteller-modus (Ekko).
-- Ett board dekker to varianter: branching (velg-selv-eventyr med a/b-valg som forgrener) og
-- madlib (tulle-fortelling der agenten ber om ord og vever dem inn). Motsatt variants felt
-- står null/tomt. Én aktiv fortelling per bruker — uavhengig av quiz (egen tabell, egen tilstand).
-- `story` (full tekst) holdes skjult til ended=true så delt skjerm ikke røper slutten.
-- `bible` er den interne fortellings-bibelen (kanon + bue + tone) — aldri en del av board-skjemaet.

CREATE TABLE IF NOT EXISTS story_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind text NOT NULL,                            -- 'branching' | 'madlib'
	title text,
	theme text,
	current_player text,                           -- hvem agenten venter på (null = hvem som helst)
	active boolean NOT NULL DEFAULT true,
	ended boolean NOT NULL DEFAULT false,
	story text,                                    -- full tekst — avsløres først når ended
	bible text NOT NULL DEFAULT '',                -- intern fortellings-bibel (skjult bak world)
	-- branching
	phase text,                                    -- 'setup' | 'adventure' | null
	world jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{ label, value }] — den fantastiske verdenen
	passage text,                                  -- gjeldende avsnitt (vises på skjerm)
	choices jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ id, label }] — alltid to («a»/«b»), tom når ended
	last_choice text,
	step integer NOT NULL DEFAULT 0,               -- antall avsnitt fortalt
	history jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ passage, choiceLabel }] — tidligere avsnitt
	-- madlib
	request text,                                  -- ordet agenten ber om nå; null når alle samlet
	blanks_filled integer NOT NULL DEFAULT 0,
	blanks_total integer NOT NULL DEFAULT 0,
	filled jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{ slot, word }] — innsamlede ord
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_sessions_user_idx ON story_sessions (user_id);
-- Maks én aktiv fortelling per bruker; en ny «start» deaktiverer den forrige først.
CREATE UNIQUE INDEX IF NOT EXISTS story_sessions_active_user_uq ON story_sessions (user_id) WHERE active;
