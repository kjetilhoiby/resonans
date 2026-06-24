-- Hybrid klient-verktøy for assistenten (Ekko). Når modellen kaller et klient-verktøy
-- (driveDistance/resolvePlace/nearestPlace/sendToCar) som må kjøres on-device, suspenderes
-- turen: den åpne strømmen sender toolCall-ene og lukkes. Denne tabellen holder den efemære
-- agent-tilstanden (OpenAI-meldingene så langt + de ventende klient-kallene) til klienten POSTer
-- resultatet til /api/apps/assistant/tool-result, som gjenopptar og strømmer videre.
-- Slettes ved fullføring; gamle rader (klienten kom aldri tilbake) TTL-ryddes ved neste lagring.
CREATE TABLE IF NOT EXISTS assistant_pending_turns (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id),
	conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	messages jsonb NOT NULL,
	pending_tool_calls jsonb NOT NULL,
	used_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_pending_turns_conversation_idx
	ON assistant_pending_turns (conversation_id);
CREATE INDEX IF NOT EXISTS assistant_pending_turns_created_idx
	ON assistant_pending_turns (created_at);
