-- Funn: kolonnen «theme» lagret egentlig et domene (food/home/…), ikke et
-- brukertema. Renam til «domain» for å fjerne forvirringen. Idempotent.

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'finds' AND column_name = 'theme'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'finds' AND column_name = 'domain'
	) THEN
		ALTER TABLE finds RENAME COLUMN theme TO domain;
	END IF;
END $$;
