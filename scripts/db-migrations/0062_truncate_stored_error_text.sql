-- Kapp feiltekst som alt ligger i basen.
--
-- Målt i prod 4. september 2026 gjennom /api/diagnostikk: 28 feilede
-- `workout_projection_refresh`-rader i `background_jobs`, til sammen ~19 MiB
-- feiltekst, største enkeltmelding **780 277 tegn**. Alle 28 fingeravtrykk
-- unike, altså bygget hver melding inn ulike data.
--
-- Kilden er drizzles `DrizzleQueryError`, som legger hele SQL-en og HVER
-- parameter i meldingen sin. `refreshForRange` setter inn opptil 2000
-- canonical-rader i ett insert — ~38 000 parametere, hvorav fire kolonner er
-- jsonb som serialiseres til fulle JSON-strenger.
--
-- Skrivestien er rettet i $lib/domain/error-text.ts. Denne migrasjonen rydder
-- det som alt står der. Grensa er den samme (MAX_STORED_ERROR_LENGTH = 2000).
--
-- NB: kappingen her er en ren `substring`, ikke den samme reduksjonen som
-- skrivestien gjør. For en drizzle-feil betyr det at de gamle radene beholder
-- SQL-prefikset og mister `params`-halen — årsaken lå på `cause` og var aldri
-- i den lagrede teksten til å begynne med, så det er ingenting å berge der.
-- Nye rader får årsaken med.
--
-- Idempotent: en andre kjøring treffer ingen rader, siden WHERE-en gater på
-- lengden.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_name = 'background_jobs' AND column_name = 'error') THEN
		UPDATE background_jobs
		SET error = substring(error FROM 1 FOR 2000)
		WHERE error IS NOT NULL AND length(error) > 2000;
	END IF;

	IF EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_name = 'cron_executions' AND column_name = 'error') THEN
		UPDATE cron_executions
		SET error = substring(error FROM 1 FOR 2000)
		WHERE error IS NOT NULL AND length(error) > 2000;
	END IF;
END $$;
