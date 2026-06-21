-- Skille mellom hvilken flate en samtale oppsto på: 'web' (chat i resonans) eller
-- 'ekko' (coach-appen). Ekko-coachen lagrer trådene sine i de samme conversations/
-- messages-tabellene, men skal ikke fylle web-chattens samtaleliste. En handoff
-- (løfte en ekko-tråd inn i web-chatten) gjøres senere ved å sette source til 'web'.
-- Eksisterende rader får 'web' via DEFAULT.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';

CREATE INDEX IF NOT EXISTS conversations_user_source_idx
	ON conversations (user_id, source, updated_at);
