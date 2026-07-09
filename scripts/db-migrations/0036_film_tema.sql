-- Film-tema: speiler bøker-modellen for film. En film ses på én kveld → ingen
-- fremdrift, men status (want_to_watch | watched) + terning + setning. Navngitte
-- lister (film_lists/film_list_items) dekker regissør-/skuespiller-utvalg.
-- Metadata + strømmetilgjengelighet (NO) kommer fra TMDB.
--
-- Se docs/changelog/2026-07-09-film-tema.md.

-- ─── films ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS films (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	tmdb_id integer,
	title text NOT NULL,
	original_title text,
	year integer,
	director text,
	runtime integer,
	poster_url text,
	backdrop_url text,
	overview text,
	genres jsonb,
	"cast" jsonb,
	status text NOT NULL DEFAULT 'want_to_watch',
	rating integer,
	review_note text,
	watched_at timestamp,
	conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
	context_status text NOT NULL DEFAULT 'none',
	context_pack jsonb,
	watch_providers jsonb,
	watch_providers_updated_at timestamp,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS films_theme_id_idx ON films (theme_id);
CREATE INDEX IF NOT EXISTS films_user_id_idx ON films (user_id);

-- ─── film_clips ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS film_clips (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	film_id uuid NOT NULL REFERENCES films(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	text text NOT NULL,
	timestamp text,
	note text,
	source text,
	created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_clips_film_id_idx ON film_clips (film_id);

-- ─── film_lists ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS film_lists (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	description text,
	kind text NOT NULL DEFAULT 'manual',
	tmdb_person_id integer,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_lists_theme_id_idx ON film_lists (theme_id);
CREATE INDEX IF NOT EXISTS film_lists_user_id_idx ON film_lists (user_id);

-- ─── film_list_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS film_list_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	list_id uuid NOT NULL REFERENCES film_lists(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	film_id uuid REFERENCES films(id) ON DELETE SET NULL,
	tmdb_id integer,
	title text NOT NULL,
	year integer,
	poster_url text,
	runtime integer,
	position integer NOT NULL DEFAULT 0,
	added_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_list_items_list_id_idx ON film_list_items (list_id);

-- ─── film_preferences ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS film_preferences (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	region text NOT NULL DEFAULT 'NO',
	provider_ids jsonb,
	provider_names jsonb,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_preferences_theme_id_idx ON film_preferences (theme_id);
