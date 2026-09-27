-- Ro: Ekkos refleksjons- og ekvanimitetsmodus (docs/ekko-ro.md).
--
-- To tabeller, bevisst små. `ro_profiles` er én tilstandsmodell per bruker –
-- temaer med progresjon og noen få uttrukne notater – ikke en dagbok. `ro_sessions`
-- holder hver økt: hvilken øvelse, hvilket tema, og refleksjonen etterpå. Teksten
-- brukeren sa (intake/reflection) beholdes bare for de ti siste øktene; eldre rader
-- nulles ut av appen, og det som er verdt å huske står i profilen.
CREATE TABLE IF NOT EXISTS ro_profiles (
	user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	state jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ro_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	mode text NOT NULL,
	theme_id text,
	structure_id text NOT NULL,
	stage text,
	focus text,
	situation text,
	closing_question text,
	intake text,
	duration_sec integer,
	reflection text,
	reply text,
	proposal jsonb,
	completed_at timestamp,
	created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ro_sessions_user_created_idx ON ro_sessions (user_id, created_at DESC);
