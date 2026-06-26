-- Ruting fra epost-kilde til person: en regel (f.eks. "Resonans/Barnehage")
-- kan knyttes til et bestemt barn, slik at oppgaver som plukkes ut tilskrives
-- riktig person ("Nils skal på tur" heller enn bare "tur").
ALTER TABLE email_rules
	ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES persons(id) ON DELETE SET NULL;
