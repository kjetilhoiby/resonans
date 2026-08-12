-- Per-konto innstillinger for bankkontoer.
--
-- Første bruker: hvilke kontoer som regnes som BUFFER på sparekontoflaten. Fram til nå var
-- det ren heuristikk på kontonavn (`looksLikeSavingsAccount`), uten en vei til å rette den
-- — og i prod ble barnas «SPAREKONTO UNG» dermed regnet inn i husholdningens buffer.
--
-- `savings_role` er tri-tilstand med vilje, ikke en boolean:
--
--   'auto'   → heuristikken bestemmer. STANDARD, og derfor virker en NY konto uten at noen
--              må huske å slå den på.
--   'buffer' → alltid med, uansett navn.
--   'ignore' → alltid ute.
--
-- En boolean kunne ikke skilt «heuristikken sa nei, og jeg er enig» fra «jeg har aktivt sagt
-- nei». Verre: en ren inkluderingsliste ville gjort at nye kontoer stille falt ut, og en ren
-- ekskluderingsliste at en konto heuristikken IKKE fanget aldri kunne legges til.
CREATE TABLE IF NOT EXISTS bank_account_settings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	account_id text NOT NULL,
	savings_role text NOT NULL DEFAULT 'auto',
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

-- Én rad per konto per bruker. Upserten hviler på denne.
CREATE UNIQUE INDEX IF NOT EXISTS bank_account_settings_user_account_idx
	ON bank_account_settings (user_id, account_id);
