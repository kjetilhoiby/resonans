-- Brukerføringer for adaptive treningsprogrammer. Settes av coachen (chat) når
-- brukeren foreslår justeringer, og respekteres av den ukentlige rekalkuleringen
-- i adaptive-service.ts:
--   pinnedDays   — ukedager (1=man..7=søn) der løpsøkter IKKE skal flyttes bort
--   lockPace     — hopp over automatisk temporekalkulering
--   volumeBias   — multiplikator brukeren ønsker på fremtidig volum (1 = uendret)
--   notes        — frie føringer coachen noterte (vises for kontekst)
--
-- Eget DO-block for isolert exception handling (samme mønster som 0006/0016).

DO $$
BEGIN
  ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS preferences jsonb;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'training_programs.preferences finnes, skipper';
END $$;
