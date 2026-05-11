-- Relativ effort på trening: per-økt-skår + metode på canonical_workouts.
-- weeklyEffort lever i sensor_aggregates.metrics (jsonb) og krever ingen DDL.

ALTER TABLE "canonical_workouts" ADD COLUMN IF NOT EXISTS "effort_score" numeric;
ALTER TABLE "canonical_workouts" ADD COLUMN IF NOT EXISTS "effort_method" text;
