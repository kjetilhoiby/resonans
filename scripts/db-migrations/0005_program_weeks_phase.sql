-- Legg til 'phase'-kolonne på program_weeks for fase-merking.
-- Mulige verdier (ikke håndhevet på DB-nivå — kun konvensjon):
--   'rutine' | 'fart' | 'distanse' | 'test' | 'deload' | null
ALTER TABLE program_weeks ADD COLUMN IF NOT EXISTS phase text;
