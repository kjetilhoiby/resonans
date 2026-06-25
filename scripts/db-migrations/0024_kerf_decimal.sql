-- Sagsnitt (kerf) skal ha desimaler og en realistisk standard.
-- Et ekte sagblad tar ~1.8 mm; 0 var bare en plassholder (ingen UI satte det).
-- Bytt integer → double precision, sett standard 1.8, og løft eksisterende 0-rader.

ALTER TABLE cut_lists ALTER COLUMN kerf_mm TYPE double precision USING kerf_mm::double precision;
ALTER TABLE cut_lists ALTER COLUMN kerf_mm SET DEFAULT 1.8;
UPDATE cut_lists SET kerf_mm = 1.8 WHERE kerf_mm = 0;
