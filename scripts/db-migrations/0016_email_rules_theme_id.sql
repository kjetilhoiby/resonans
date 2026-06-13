-- Knytt epostregler til et tema (valgfritt). Brukes bl.a. for å vise
-- bibliotek-regler under riktig Bøker-tema i /settings/themes, og for at en
-- regel skal kunne mate ett bestemt domene. Additiv, idempotent.
-- ON DELETE SET NULL: regelen overlever om temaet arkiveres/slettes — den blir
-- bare global igjen.
-- Følger rutinen i CLAUDE.md: SQL-migrasjonen er autoritativ kilde; drizzle-kit
-- push ser etterpå matchende state og blir en no-op.

ALTER TABLE email_rules ADD COLUMN IF NOT EXISTS theme_id uuid REFERENCES themes(id) ON DELETE SET NULL;
