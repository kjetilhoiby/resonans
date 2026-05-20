-- Delbare lenker: én token gir tilgang til én ressurs (sjekkliste, tema-liste, eller live posisjon/Ekko).
-- Polymorf: resourceType + resourceId. Integritet håndteres i applaget (ingen FK på resourceId).
-- Tokens lagres som rå strenger (ikke hashet) fordi eier må kunne hente og gjenbruke URL-en.
-- Mitigering: 24 bytes base64url, valgfri expiresAt, revoke via revokedAt.

CREATE TABLE IF NOT EXISTS "share_tokens" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "resource_type" text NOT NULL,           -- 'checklist' | 'themeList' | 'tripPosition'
    "resource_id" uuid NOT NULL,             -- checklists.id | theme_lists.id | themes.id
    "token" text NOT NULL UNIQUE,
    "access_mode" text NOT NULL DEFAULT 'read',  -- 'read' | 'write'
    "allowed_email" text,                    -- null = åpen lenke
    "label" text,
    "expires_at" timestamp,
    "revoked_at" timestamp,
    "last_accessed_at" timestamp,
    "access_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "share_tokens_owner_idx"
    ON "share_tokens" ("owner_user_id", "revoked_at");

CREATE INDEX IF NOT EXISTS "share_tokens_resource_idx"
    ON "share_tokens" ("resource_type", "resource_id");

-- Spor hvilken delings-token som ble brukt for å hake av et element (for audit i eierens visning).
ALTER TABLE "checklist_items"
    ADD COLUMN IF NOT EXISTS "checked_via_share_token_id" uuid;

ALTER TABLE "theme_list_items"
    ADD COLUMN IF NOT EXISTS "checked_via_share_token_id" uuid;
