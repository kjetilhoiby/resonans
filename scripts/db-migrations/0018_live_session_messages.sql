-- Live-meldinger fra seere på en delt posisjon (retur-kanal ekko ↔ Resonans).
-- Seeren skriver via dele-siden (offentlig), løper-appen poller nye meldinger.
-- `seq` er en monotont voksende markør appen sender tilbake som `after`.

CREATE TABLE IF NOT EXISTS live_session_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	seq bigserial NOT NULL,
	session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
	sender text,
	text text NOT NULL,
	created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS live_session_messages_session_seq_idx
	ON live_session_messages (session_id, seq);
