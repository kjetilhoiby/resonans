-- Ekko v1.1 — TVING gjennom de samme kolonnene som 0002 prøvde å legge til.
--
-- Bakgrunn: 0002 brukte DO-blocks med EXCEPTION-handlere som potensielt
-- svelget ekte ALTER-feil og lot apply-sql-migrations bokføre 0002 som
-- "applisert" selv om enkeltkolonner manglet. Resultat: insert i
-- training_programs feilet med 'baseline'-kolonne mangler.
--
-- Denne migrasjonen har et nytt filnavn, så apply-sql-migrations vil
-- kjøre den på nytt uavhengig av hva 0002 etterlot. Ingen DO-blocks —
-- hvis noe feiler skal vi se det loud i deploy-loggen.

ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS best_efforts jsonb;
ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS gap_sec_per_km numeric;
ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS hr_zone_distribution jsonb;
ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS analytics_computed_at timestamp;

ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS baseline jsonb;

ALTER TABLE program_sessions ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE program_sessions ADD COLUMN IF NOT EXISTS test_type text;

CREATE TABLE IF NOT EXISTS program_test_results (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	program_id uuid REFERENCES training_programs(id) ON DELETE SET NULL,
	session_id uuid REFERENCES program_sessions(id) ON DELETE SET NULL,
	sensor_event_id uuid REFERENCES sensor_events(id) ON DELETE SET NULL,
	test_type text NOT NULL,
	recorded_at timestamp NOT NULL,
	result jsonb NOT NULL,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS program_test_results_user_type_idx
	ON program_test_results (user_id, test_type, recorded_at);

CREATE INDEX IF NOT EXISTS program_test_results_program_type_idx
	ON program_test_results (program_id, test_type, recorded_at);

-- Diagnostikk: rapporter hvilke v1.1-kolonner som faktisk finnes nå.
-- Resultatet vises i deploy-loggen via NOTICE.
DO $$
DECLARE
	col_count int;
BEGIN
	SELECT count(*) INTO col_count
	FROM information_schema.columns
	WHERE table_name IN ('canonical_workouts', 'training_programs', 'program_sessions')
	AND column_name IN ('best_efforts', 'gap_sec_per_km', 'hr_zone_distribution',
		'analytics_computed_at', 'baseline', 'is_test', 'test_type');
	RAISE NOTICE '[0003_force_v1_1] v1.1-kolonner i prod nå: % av 7 forventede', col_count;
END $$;
