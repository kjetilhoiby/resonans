-- Hus-prosjekt som undertema av Hjem (parentTheme='Hjem'). Prosjekt-metadata
-- (rom, status, datoer, coverbilde) lagres i JSONB-kolonnen `project_profile` på
-- `themes` (speiler `ferie_profile`/`trip_profile`). Additiv, idempotent.
-- Følger rutinen i CLAUDE.md: eksplisitt SQL-migrasjon er autoritativ kilde;
-- drizzle-kit push ser etterpå matchende state og blir en no-op.

ALTER TABLE themes ADD COLUMN IF NOT EXISTS project_profile jsonb;
