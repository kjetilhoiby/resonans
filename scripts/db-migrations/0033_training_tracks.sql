-- Treningsløp: to uavhengige progresjonsløp (styrke + utholdenhet) som måles
-- mot faktiske Ekko-registreringer, uten pre-generert øktstruktur.
--
-- training_plans er ankeret Ekko ser (plan-id = programId i /api/apps/programs),
-- training_tracks er de to løpene, track_sessions materialiseres on-demand når
-- Ekko henter /today (gir stabil plannedSessionId), track_milestones er
-- kontrollpunkter (f.eks. pull-up-faser), track_readiness_assessments speiler
-- den gamle readiness-cachen men FK-er mot training_plans.
--
-- Se docs/changelog/2026-07-05-treningslop.md.

-- ─── training_plans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_plans (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	status text NOT NULL DEFAULT 'active',
	start_date date NOT NULL,
	duration_weeks integer NOT NULL DEFAULT 26,
	schedule jsonb,
	preferences jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_plans_user_status_idx
	ON training_plans (user_id, status, created_at);

-- ─── training_tracks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_tracks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	plan_id uuid NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
	kind text NOT NULL,
	name text NOT NULL,
	status text NOT NULL DEFAULT 'active',
	start_date date NOT NULL,
	target_date date NOT NULL,
	baseline jsonb,
	goal jsonb NOT NULL,
	config jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_tracks_plan_idx
	ON training_tracks (plan_id, kind);
CREATE INDEX IF NOT EXISTS training_tracks_user_status_idx
	ON training_tracks (user_id, status);

-- ─── track_milestones ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS track_milestones (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	track_id uuid NOT NULL REFERENCES training_tracks(id) ON DELETE CASCADE,
	"order" integer NOT NULL,
	name text NOT NULL,
	criteria jsonb NOT NULL,
	achieved_at timestamp,
	sensor_event_id uuid REFERENCES sensor_events(id) ON DELETE SET NULL,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS track_milestones_track_order_idx
	ON track_milestones (track_id, "order");

-- ─── track_sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS track_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	track_id uuid NOT NULL REFERENCES training_tracks(id) ON DELETE CASCADE,
	plan_id uuid NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
	date date NOT NULL,
	kind text NOT NULL,
	payload jsonb NOT NULL,
	status text NOT NULL DEFAULT 'suggested',
	completed_at timestamp,
	sensor_event_id uuid REFERENCES sensor_events(id) ON DELETE SET NULL,
	actuals jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
	ALTER TABLE track_sessions
		ADD CONSTRAINT track_sessions_track_date_unique UNIQUE (track_id, date);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS track_sessions_user_date_idx
	ON track_sessions (user_id, date);
CREATE INDEX IF NOT EXISTS track_sessions_plan_date_idx
	ON track_sessions (plan_id, date);

-- ─── track_readiness_assessments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS track_readiness_assessments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	plan_id uuid NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
	track_session_id uuid REFERENCES track_sessions(id) ON DELETE CASCADE,
	assessment_date date NOT NULL,
	state text NOT NULL,
	reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
	signals jsonb NOT NULL DEFAULT '{}'::jsonb,
	alternative jsonb,
	signal_fingerprint text NOT NULL,
	user_choice text,
	user_choice_at timestamp,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
	ALTER TABLE track_readiness_assessments
		ADD CONSTRAINT track_readiness_user_plan_date_uniq UNIQUE (user_id, plan_id, assessment_date);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS track_readiness_user_date_idx
	ON track_readiness_assessments (user_id, assessment_date);
