-- Tags på skrivedokumenter — se docs/changelog/2026-08-07-skriveprosjekt.md.
--
-- Den andre aksen: `kind` sier hva et dokument ER, tags sier hva det HANDLER OM
-- eller DELTAR I. Buer og fortellergrep går på tvers av scener, og et `kind`
-- kunne ikke uttrykt det — en bue er et spenn, ikke et dokument scenene ligger i.
--
-- Fritekst, ikke referanser til karakter-dokumenter: typede referanser ville
-- krevd en koblingstabell og UI for å vedlikeholde den. Motgiften mot drift er
-- autofullføring fra tags som allerede finnes.
--
-- Samme kolonneform som meals/recipes bruker fra før.

ALTER TABLE writing_docs
	ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];

-- GIN-indeks: filtrering skjer med `tags && ARRAY[...]` (overlapp), som ikke kan
-- bruke en vanlig btree.
CREATE INDEX IF NOT EXISTS writing_docs_tags_idx
	ON writing_docs USING gin (tags);
