-- Ekko v1.1 — analytics-kolonner på canonical_workouts, baseline på
-- training_programs, is_test/test_type på program_sessions, og ny tabell
-- program_test_results.
--
-- Skrives som eksplisitt SQL fordi drizzle-kit push --force noen ganger
-- ikke fanger opp additive endringer pålitelig i deploy-pipelinen — etter
-- merge av Ekko v1.1 (PR #89) fikk vi 500 på /treningsprogram/ny pga.
-- manglende best_efforts-kolonne på canonical_workouts.
--
-- Hver endring i sitt eget DO-block med isolert exception handling slik at
-- én feil ikke ryker hele transaksjonen. Idempotent: alle statements bruker
-- IF NOT EXISTS / IF EXISTS-grener.

-- ─── canonical_workouts: analytics-felter ───────────────────────────────────
DO $$
BEGIN
	ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS best_efforts jsonb;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'canonical_workouts.best_efforts: %', SQLERRM;
END $$;

DO $$
BEGIN
	ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS gap_sec_per_km numeric;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'canonical_workouts.gap_sec_per_km: %', SQLERRM;
END $$;

DO $$
BEGIN
	ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS hr_zone_distribution jsonb;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'canonical_workouts.hr_zone_distribution: %', SQLERRM;
END $$;

DO $$
BEGIN
	ALTER TABLE canonical_workouts ADD COLUMN IF NOT EXISTS analytics_computed_at timestamp;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'canonical_workouts.analytics_computed_at: %', SQLERRM;
END $$;

-- ─── training_programs: baseline-snapshot ───────────────────────────────────
DO $$
BEGIN
	ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS baseline jsonb;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'training_programs.baseline: %', SQLERRM;
END $$;

-- ─── program_sessions: test-økt-felter ──────────────────────────────────────
DO $$
BEGIN
	ALTER TABLE program_sessions ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'program_sessions.is_test: %', SQLERRM;
END $$;

DO $$
BEGIN
	ALTER TABLE program_sessions ADD COLUMN IF NOT EXISTS test_type text;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'program_sessions.test_type: %', SQLERRM;
END $$;

-- ─── program_test_results: ny tabell ────────────────────────────────────────
DO $$
BEGIN
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
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'program_test_results table: %', SQLERRM;
END $$;

DO $$
BEGIN
	CREATE INDEX IF NOT EXISTS program_test_results_user_type_idx
		ON program_test_results (user_id, test_type, recorded_at);
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'program_test_results_user_type_idx: %', SQLERRM;
END $$;

DO $$
BEGIN
	CREATE INDEX IF NOT EXISTS program_test_results_program_type_idx
		ON program_test_results (program_id, test_type, recorded_at);
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'program_test_results_program_type_idx: %', SQLERRM;
END $$;
