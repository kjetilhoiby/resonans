-- Live-tilstand for spillskjermen: gjeldende spørsmål, hvem sin tur, og siste resultat.
-- Lar /spill (og delt /share-lenke) vise et ekte scoreboard + spørsmålskort mens stemmen
-- driver quizen. Fasiten (current_answer) avsløres på skjermen først når svaret er registrert.
ALTER TABLE quiz_sessions
	ADD COLUMN IF NOT EXISTS current_player text,
	ADD COLUMN IF NOT EXISTS current_question text,
	ADD COLUMN IF NOT EXISTS current_answer text,
	ADD COLUMN IF NOT EXISTS last_result jsonb;
