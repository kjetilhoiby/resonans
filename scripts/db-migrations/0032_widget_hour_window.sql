-- Timevindu-filter for widgets (f.eks. skjermtid kl. 16–19).
-- filter_hour_from er inklusiv (0–23), filter_hour_to er eksklusiv (1–24).
-- NULL = hele døgnet (dagens oppførsel).
ALTER TABLE user_widgets ADD COLUMN IF NOT EXISTS filter_hour_from integer;
ALTER TABLE user_widgets ADD COLUMN IF NOT EXISTS filter_hour_to integer;
