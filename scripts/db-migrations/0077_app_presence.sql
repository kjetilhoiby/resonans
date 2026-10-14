-- «Hvor er jeg nå» fra en ekstern app (i dag Akser), når brukeren har slått det på.
--
-- ÉN rad per bruker og app, som overskrives: ingen historikk, så tabellen kan
-- ikke bli et spor. Det som skjedde kommer med de ferdige dagene (timeline).
-- Posisjonen er avrundet til ~1 km (to desimaler); på et kjent sted lagres bare
-- stedets id. Slås delingen av, slettes raden (DELETE /api/apps/akser/now).
-- Se docs/akser-tidslinje.md og $lib/domain/movement/presence.ts.

CREATE TABLE IF NOT EXISTS app_presence (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	app text NOT NULL,
	-- 'stay' eller 'journey'
	state text NOT NULL,
	-- Appens sted-id (app_places.external_id) når brukeren er på et kjent sted
	place_external_id text,
	-- Transportform på en reise
	mode text,
	latitude double precision,
	longitude double precision,
	since timestamp with time zone NOT NULL,
	generated_at timestamp with time zone NOT NULL,
	updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_presence_user_app_idx ON app_presence (user_id, app);
