-- Skriveprosjekt og notatblokk — se docs/changelog/2026-08-07-skriveprosjekt.md
--
-- To tabeller, ikke fire. `writing_docs.kind` dekker scene, kapittel, karakter,
-- sted, notat, dikt, liste og transkripsjon, av samme grunn som
-- streak_definitions dekker tre streak-semantikker i én tabell: de er dokumenter
-- med ulik rolle, ikke ulike ting. sort_order er det som lar en «skrive det hele
-- sammen».
--
-- ARBEIDSDELING MOT reflections: reflections eier FANGST (tidsstemplede
-- øyeblikksbilder med period_key — dagsnotat fra bilen, feriedagbok), writing_docs
-- eier DOKUMENTER man kommer tilbake til og redigerer. Derfor har writing_docs
-- tittel og updated_at, som reflections bevisst ikke har.
--
-- project_id er NULLABLE: et fritt notat i notatblokka hører ikke til noe prosjekt.
-- Å flytte et notat inn i et prosjekt er å sette project_id + kind.
--
-- Ingen HNSW-indeks ennå, av samme grunn som 0037: tabellene er små nok for
-- sekvensiell skanning. Legg til USING hnsw (embedding vector_cosine_ops) når
-- radantallet krever det.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS writing_projects (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	theme_id uuid REFERENCES themes(id) ON DELETE SET NULL,
	title text NOT NULL,
	genre text,                                        -- fritekst: 'roman', 'diktsamling', 'noveller'
	summary text,                                      -- kort premiss, mates inn i sparring-modus
	status text NOT NULL DEFAULT 'active',             -- 'active' | 'paused' | 'done' | 'archived'
	-- Egen samtale per prosjekt, som books.conversation_id. Kompislesingen lever her.
	conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writing_projects_user_idx
	ON writing_projects (user_id, status);

CREATE TABLE IF NOT EXISTS writing_docs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- NULL = fritt dokument i notatblokka, ikke del av et prosjekt.
	project_id uuid REFERENCES writing_projects(id) ON DELETE SET NULL,
	kind text NOT NULL DEFAULT 'notat',                -- se src/lib/domain/writing/doc-kinds.ts
	title text NOT NULL DEFAULT '',
	body text NOT NULL DEFAULT '',
	status text NOT NULL DEFAULT 'utkast',             -- 'utkast' | 'pagar' | 'ferdig'
	sort_order integer NOT NULL DEFAULT 0,
	-- Semantisk søk (text-embedding-3-small, samme modell som memories/reflections
	-- — derfor er cosine-avstandene sammenlignbare på tvers av tabellene).
	embedding vector(1536),
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writing_docs_user_updated_idx
	ON writing_docs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS writing_docs_project_idx
	ON writing_docs (project_id, kind, sort_order);
