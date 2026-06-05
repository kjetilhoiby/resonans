-- Strava-synk (proxy for ekko). Resonans eier Strava-koblingen og pusher GPX
-- til Strava server-side fra den eksisterende /api/apps/upload-flyten. Tre
-- tabeller: per-bruker kobling (krypterte tokens), kortvarig OAuth-state-nonce,
-- og dedup/resultatsporing per opplastet økt. Additivt og idempotent.

CREATE TABLE IF NOT EXISTS strava_connections (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
	athlete_id bigint,
	athlete_name text,
	access_token text NOT NULL,
	refresh_token text NOT NULL,
	expires_at timestamp,
	scope text,
	last_sync_at timestamp,
	last_sync_status text,
	last_sync_error text,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

-- Additive kolonner for tilfellet der tabellen ble opprettet av en tidligere
-- drizzle push uten alle kolonnene.
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS athlete_id bigint;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS athlete_name text;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS expires_at timestamp;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS last_sync_at timestamp;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS last_sync_status text;
ALTER TABLE strava_connections ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE TABLE IF NOT EXISTS strava_oauth_states (
	state text PRIMARY KEY,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	app_id text NOT NULL DEFAULT 'ekko',
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strava_uploads (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	session_id text NOT NULL,
	external_id text NOT NULL,
	sensor_event_id uuid,
	strava_upload_id bigint,
	strava_activity_id bigint,
	status text NOT NULL DEFAULT 'pending',
	error text,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE strava_uploads ADD COLUMN IF NOT EXISTS sensor_event_id uuid;
ALTER TABLE strava_uploads ADD COLUMN IF NOT EXISTS strava_upload_id bigint;
ALTER TABLE strava_uploads ADD COLUMN IF NOT EXISTS strava_activity_id bigint;
ALTER TABLE strava_uploads ADD COLUMN IF NOT EXISTS error text;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'strava_uploads_user_session_uniq'
	) THEN
		ALTER TABLE strava_uploads
			ADD CONSTRAINT strava_uploads_user_session_uniq UNIQUE (user_id, session_id);
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS strava_uploads_user_status_idx ON strava_uploads (user_id, status);
