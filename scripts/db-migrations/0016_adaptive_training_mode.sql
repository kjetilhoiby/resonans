-- Adaptiv treningsmodus — programmer kan settes i mode='adaptiv' som justerer
-- seg ukentlig: tempo rekalkuleres dempet fra faktiske løp, neste ukes økter
-- flyttes til dagene brukeren faktisk pleier å løpe slike turer, og volum
-- evalueres på effort-fordeling (styrke/løp/sykkel) i stedet for missede økter.
--
-- program_adaptations logger hver justering med begrunnelse, slik at coachen
-- (og brukeren) kan se *hvorfor* planen endret seg.
--
-- Hver endring i sitt eget DO-block for isolert exception handling (samme
-- mønster som 0002/0006).

DO $$
BEGIN
  ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'fast';
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'training_programs.mode finnes, skipper';
END $$;

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS program_adaptations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id uuid NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    week_number integer NOT NULL,
    kind text NOT NULL,
    changes jsonb NOT NULL DEFAULT '{}'::jsonb,
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  );
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
  RAISE NOTICE 'program_adaptations allerede opprettet, skipper';
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS program_adaptations_program_created_idx
    ON program_adaptations (program_id, created_at DESC);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'program_adaptations_program_created_idx finnes, skipper';
END $$;
