-- Modellversjonen av hjemskjermens brev (prototype på /brev).
--
-- Én rad per bruker og Oslo-dag. Teksten skrives på nytt bare når fakta-hashen
-- endrer seg (et nytt måltid, en ny veiing), samme mønster som
-- workout_assessments.context_hash: et modellkall per sidevisning ville kostet
-- tid og penger for samme tekst, og gitt en ny formulering hver gang siden åpnes.
-- Se docs/changelog/2026-10-06-brev-prototype.md, fase 6.

CREATE TABLE IF NOT EXISTS home_letter_drafts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- Oslo-dagen brevet gjelder, YYYY-MM-DD.
	day text NOT NULL,
	letter text NOT NULL,
	model text,
	context_hash text NOT NULL,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS home_letter_drafts_user_day_idx ON home_letter_drafts (user_id, day);
