-- Vedvarende samtaletilstand for Ekko-coachen (POST /api/apps/coach med conversationId).
-- Serveren eier tråden: klienten sender ny ytring + en opak conversationId, serveren
-- bygger full kontekst fra de lagrede turene. Egen tabell (ikke `conversations`) fordi
-- dette er en talevennlig coach-tråd uten temaer/relasjoner/stjernemerking.

CREATE TABLE IF NOT EXISTS coach_conversations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title text,
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS coach_conversations_user_idx
	ON coach_conversations (user_id, updated_at);

-- Turer i en coach-samtale. Lagrer KUN 'user'/'assistant' — aldri efemær situasjonskontekst.
CREATE TABLE IF NOT EXISTS coach_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	conversation_id uuid NOT NULL REFERENCES coach_conversations(id) ON DELETE CASCADE,
	role text NOT NULL,
	text text NOT NULL,
	created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS coach_messages_conversation_created_idx
	ON coach_messages (conversation_id, created_at);
