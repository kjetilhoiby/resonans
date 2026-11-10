-- Innboks-logg for e-post fra Gmail (POST /api/email/inbound).
--
-- Én rad per Gmail-melding og bruker. Finnes for tre ting:
--   1. Dedupe: en melding som alt er behandlet kjøres ikke på nytt når scriptet
--      sender hele tråden igjen.
--   2. Delvis gjentakelse: `rules` holder utfallet per regel, så et nytt forsøk
--      kjører bare reglene som feilet.
--   3. Synlighet: innstillingene viser når siste e-post kom og hvilken versjon av
--      scriptet som sendte den. Fram til november 2026 sto scriptet og postet til
--      en adresse appen hadde flyttet fra i flere uker, og ingenting i Resonans
--      kunne si det.
--
-- Innholdet i e-posten lagres IKKE her — bare avsender, emne og utfall.
CREATE TABLE IF NOT EXISTS email_inbound_log (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	gmail_message_id text NOT NULL,
	gmail_thread_id text,
	label text,
	from_address text,
	subject text,
	received_at timestamp,
	status text NOT NULL,
	rules jsonb NOT NULL DEFAULT '[]'::jsonb,
	error text,
	attempts integer NOT NULL DEFAULT 1,
	script_version integer,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_inbound_log_user_message_idx
	ON email_inbound_log (user_id, gmail_message_id);

CREATE INDEX IF NOT EXISTS email_inbound_log_user_updated_idx
	ON email_inbound_log (user_id, updated_at DESC);
