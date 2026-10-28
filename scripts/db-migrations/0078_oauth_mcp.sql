-- MCP-serveren med OAuth (docs/mcp.md): Claude og ChatGPT kobler seg til Resonans
-- som en connector og logger inn med brukerens Google-innlogging.
--
-- `oauth_clients` fylles av klientene selv (dynamisk registrering, RFC 7591).
-- `oauth_authorization_codes` er engangskoder med fem minutters levetid.
-- `oauth_grants` er én rad per godkjent tilkobling; tokenene roteres på raden.
-- Alle token og hemmeligheter lagres som sha256-hasher, aldri i klartekst.
CREATE TABLE IF NOT EXISTS oauth_clients (
	client_id text PRIMARY KEY,
	client_name text,
	redirect_uris jsonb NOT NULL,
	token_endpoint_auth_method text NOT NULL DEFAULT 'none',
	client_secret_hash text,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
	code_hash text PRIMARY KEY,
	client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	redirect_uri text NOT NULL,
	code_challenge text NOT NULL,
	scope text NOT NULL,
	expires_at timestamp NOT NULL,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_grants (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
	scope text NOT NULL,
	access_token_hash text NOT NULL UNIQUE,
	access_expires_at timestamp NOT NULL,
	refresh_token_hash text NOT NULL UNIQUE,
	refresh_expires_at timestamp NOT NULL,
	last_used_at timestamp,
	revoked_at timestamp,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_grants_user_active_idx ON oauth_grants (user_id, revoked_at);
