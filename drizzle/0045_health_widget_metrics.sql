-- Oppdaterer seedede Helse-tema-widgets til ny config:
--   "Vekt" (latest)        -> "Vektendring" (delta)
--   "Hvilepuls" (heartrate) -> "Hvilepuls (søvn)" (sleepHeartRate)
-- Bare widgets med theme_id (tema-tilknyttet) og uendret seed-config blir påvirket.

UPDATE "user_widgets"
SET
    title = 'Vektendring',
    aggregation = 'delta',
    updated_at = NOW()
WHERE theme_id IS NOT NULL
  AND title = 'Vekt'
  AND metric_type = 'weight'
  AND aggregation = 'latest';

UPDATE "user_widgets"
SET
    title = 'Hvilepuls (søvn)',
    metric_type = 'sleepHeartRate',
    updated_at = NOW()
WHERE theme_id IS NOT NULL
  AND title = 'Hvilepuls'
  AND metric_type = 'heartrate';
