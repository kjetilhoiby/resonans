-- theme_research — lagrede websøk-runder («research») knyttet til et tema.
-- Chatten kan gjøre et Tavily-søk (web_search) og lagre den oppsummerte runden
-- her når brukeren undersøker noe som hører til temaet (f.eks. «hva kan jeg
-- gjøre i Hornbæk» på et ferietema). Vises som egen Research-seksjon i Filer.
--
-- NB: ikke å forveksle med `finds`-tabellen (global triage-innboks for
-- lenker/reels via e-post). Denne er per-tema og fôres fra chat-websøk.

CREATE TABLE IF NOT EXISTS theme_research (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	query text NOT NULL,
	summary text NOT NULL,
	sources jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS theme_research_theme_id_idx ON theme_research (theme_id, created_at);
