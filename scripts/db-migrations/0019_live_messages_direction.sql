-- Toveis live-meldinger: skill seer→løper (heiarop) fra løper→seer (svar).
-- Eksisterende rader er seer→løper (default).

ALTER TABLE live_session_messages
	ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'viewer_to_runner';

-- Bytt indeks til å inkludere direction, slik at retnings-filtrert polling med
-- `after`-markør er dekket.
DROP INDEX IF EXISTS live_session_messages_session_seq_idx;
CREATE INDEX IF NOT EXISTS live_session_messages_session_dir_seq_idx
	ON live_session_messages (session_id, direction, seq);
