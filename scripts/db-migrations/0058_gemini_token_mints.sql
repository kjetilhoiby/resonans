-- Bokføring av Gemini Live-tokenminting, for ratelimit per bruker.
--
-- Tokenet selv er anonymt hos Google; denne loggen (sammen med console-linja)
-- er koblingen bruker ↔ token. Ratelimiten (30/døgn, rullende) finnes ikke for
-- normal bruk — en 3-timers økt med planlagt rotasjon minter ~6 — men for en
-- klient i reconnect-sløyfe: den skal stoppes av oss med 429 + retryAfter, ikke
-- av Googles kvote uten forklaring. Se GEMINI_LIVE_VOICE_BRIEF.md §5 (ekko).

CREATE TABLE IF NOT EXISTS gemini_token_mints (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	profile text NOT NULL,
	minted_at timestamp NOT NULL DEFAULT now(),
	created_at timestamp NOT NULL DEFAULT now()
);

-- Oppslaget er alltid «brukerens minter siste døgn».
CREATE INDEX IF NOT EXISTS gemini_token_mints_user_minted_idx
	ON gemini_token_mints (user_id, minted_at DESC);
