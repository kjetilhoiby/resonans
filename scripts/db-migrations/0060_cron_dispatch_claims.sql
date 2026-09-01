-- Dispatch-krav per (jobb, slot) for cron-dispatcheren.
--
-- `cron_executions` skrives først når en jobb er FERDIG, så dedup-en i
-- /api/cron/jobs?due=1 hadde et vindu der en jobb som fortsatt kjørte så ut
-- som due. Med én klokke (GitHub Actions hvert 5. minutt) var vinduet i
-- praksis ufarlig; med to klokker (GH + in-app-dispatcheren på VPS-en) er det
-- et ekte kappløp. Kravet tas atomisk med INSERT … ON CONFLICT DO NOTHING før
-- dispatch — bare den som vant insert-en kjører slotet.

CREATE TABLE IF NOT EXISTS cron_dispatch_claims (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	job_path text NOT NULL,
	slot_at timestamp NOT NULL,
	claimed_by text,
	claimed_at timestamp NOT NULL DEFAULT now(),
	CONSTRAINT cron_dispatch_claims_job_slot_uniq UNIQUE (job_path, slot_at)
);

-- Prunes på alder (7 dager), samme mønster som cron_executions.
CREATE INDEX IF NOT EXISTS cron_dispatch_claims_claimed_at_idx
	ON cron_dispatch_claims (claimed_at);
