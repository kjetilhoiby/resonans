-- Kjente steder fra en ekstern app (i dag Akser): hjem, jobb, hytta.
--
-- Hver app eier sine egne steder, og Resonans skriver aldri tilbake. Lista
-- sendes HEL fra appen (PUT /api/apps/akser/places); et sted som mangler
-- arkiveres, det slettes ikke, siden gamle dager i tidslinjen peker på det.
--
-- Egen tabell, ikke sensor_events: et sted kan redigeres og arkiveres, det er
-- ikke en hendelse med et tidspunkt. `app` er med så Ekkos steder kan legges
-- ved siden av senere, og koblingen mellom dem bor i Resonans.
-- Se docs/akser-tidslinje.md og docs/changelog/2026-10-06-akser-integrasjon.md.

CREATE TABLE IF NOT EXISTS app_places (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- 'akser' (senere 'ekko'). Samme id som i APP_REGISTRY.
	app text NOT NULL,
	-- Appens egen id for stedet. Tidslinjen peker på denne, ikke på vår.
	external_id text NOT NULL,
	name text NOT NULL,
	category text NOT NULL,
	latitude double precision NOT NULL,
	longitude double precision NOT NULL,
	radius_meters integer NOT NULL,
	-- false er appens automatiske «Nytt sted»: lagres, men vises ikke med navn.
	named boolean NOT NULL DEFAULT false,
	archived boolean NOT NULL DEFAULT false,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_places_user_app_external_idx
	ON app_places (user_id, app, external_id);
