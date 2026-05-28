-- Program readiness — daglig tilstand-vurdering for treningsprogram-dager.
-- Lagrer beregnet state + reasons + AI-generert erstatningsøkt slik at vi
-- ikke kaller gpt-4o-mini på hver page-load. Kan også brukes som audit-log
-- for "kjørte original likevel"-valg.
--
-- Hver endring i sitt eget DO-block for isolert exception handling (samme
-- mønster som 0002).

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS program_readiness_assessments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    planned_session_id uuid REFERENCES program_sessions(id) ON DELETE CASCADE,
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
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
  RAISE NOTICE 'program_readiness_assessments allerede opprettet, skipper';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS program_readiness_user_program_date_uniq
    ON program_readiness_assessments (user_id, program_id, assessment_date);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'program_readiness_user_program_date_uniq finnes, skipper';
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS program_readiness_user_date_idx
    ON program_readiness_assessments (user_id, assessment_date DESC);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'program_readiness_user_date_idx finnes, skipper';
END $$;
