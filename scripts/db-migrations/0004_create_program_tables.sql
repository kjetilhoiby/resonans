-- Oppretter Ekko v1.0 program-tabellene (training_programs, program_weeks,
-- program_sessions, program_exercises, program_session_completions) +
-- v1.1 program_test_results, alle med v1.1-kolonnene inkludert.
--
-- Bakgrunn: PR #89 (Ekko fase 3, v1.0) la til disse tabellene KUN via
-- schema.ts og forventet at drizzle-kit push skulle opprette dem. Det
-- gjorde det aldri på prod fordi drizzle push crasher på TTY-prompt
-- under CI. Resultat: hele program-funksjonaliteten har vært ubrukbar
-- — INSERT i training_programs feiler med 'relation does not exist'.
--
-- 0002 og 0003 prøvde å ALTER på disse tabellene, som ga 42P01-feil.
-- Denne migrasjonen oppretter dem komplett, idempotent.

-- ─── training_programs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_programs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	goal text NOT NULL,
	duration_weeks integer NOT NULL,
	sessions_per_week integer NOT NULL,
	status text NOT NULL DEFAULT 'active',
	include_strength boolean NOT NULL DEFAULT true,
	include_running boolean NOT NULL DEFAULT true,
	start_date date NOT NULL,
	generated_with jsonb,
	baseline jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_programs_user_status_idx
	ON training_programs (user_id, status, created_at);

-- ─── program_weeks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_weeks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	program_id uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
	week_number integer NOT NULL,
	deload boolean NOT NULL DEFAULT false,
	notes text,
	created_at timestamp NOT NULL DEFAULT now(),
	CONSTRAINT program_weeks_program_week_unique UNIQUE (program_id, week_number)
);

-- ─── program_sessions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	week_id uuid NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
	program_id uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
	day_number integer NOT NULL,
	kind text NOT NULL,
	name text NOT NULL,
	rest_seconds integer,
	planned_run jsonb,
	is_test boolean NOT NULL DEFAULT false,
	test_type text,
	notes text,
	created_at timestamp NOT NULL DEFAULT now(),
	CONSTRAINT program_sessions_week_day_unique UNIQUE (week_id, day_number)
);

CREATE INDEX IF NOT EXISTS program_sessions_week_day_idx
	ON program_sessions (week_id, day_number);

CREATE INDEX IF NOT EXISTS program_sessions_program_day_idx
	ON program_sessions (program_id, day_number);

-- ─── program_exercises ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_exercises (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	session_id uuid NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
	"order" integer NOT NULL,
	exercise_name text NOT NULL,
	sets integer NOT NULL,
	reps_target integer,
	duration_seconds_target integer,
	weight_hint text,
	notes text,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS program_exercises_session_order_idx
	ON program_exercises (session_id, "order");

-- ─── program_session_completions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_session_completions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	program_id uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
	planned_session_id uuid NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
	sensor_event_id uuid REFERENCES sensor_events(id) ON DELETE SET NULL,
	completed_at timestamp NOT NULL,
	actuals jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	CONSTRAINT program_session_completions_planned_session_unique UNIQUE (planned_session_id)
);

CREATE INDEX IF NOT EXISTS program_session_completions_user_completed_idx
	ON program_session_completions (user_id, completed_at);

CREATE INDEX IF NOT EXISTS program_session_completions_program_completed_idx
	ON program_session_completions (program_id, completed_at);

-- ─── program_test_results (v1.1) ────────────────────────────────────────────
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

-- Diagnostikk: rapporter hvilke program-tabeller som nå finnes
DO $$
DECLARE
	tbl_count int;
BEGIN
	SELECT count(*) INTO tbl_count
	FROM information_schema.tables
	WHERE table_schema = 'current_schema'
	AND table_name IN ('training_programs', 'program_weeks', 'program_sessions',
		'program_exercises', 'program_session_completions', 'program_test_results');
	RAISE NOTICE '[0004_create_program_tables] program-tabeller i prod nå: % av 6 forventede', tbl_count;
END $$;
