-- Ferie-tema: oppholdsplan + grove reise-blokker lagres i en JSONB-kolonne
-- `ferie_profile` på `themes` (speiler `trip_profile`). Additiv, idempotent.
-- Følger rutinen i CLAUDE.md: eksplisitt SQL-migrasjon er den autoritative kilden;
-- drizzle-kit push ser etterpå matchende state og blir en no-op.

ALTER TABLE themes ADD COLUMN IF NOT EXISTS ferie_profile jsonb;
