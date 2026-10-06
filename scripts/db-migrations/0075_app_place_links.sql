-- Koblinger mellom Aksers og Ekkos steder. Hver app eier sine steder i
-- app_places; Resonans kobler dem, men slår aldri sammen og skriver aldri tilbake.
--
-- status: 'auto' (overlapp og samme kategori eller samme navn), 'suggested'
-- (overlapp ellers — brukeren bekrefter), 'confirmed' og 'rejected' (brukerens
-- valg, som aldri regnes ut på nytt). Reglene står i
-- src/lib/domain/movement/place-links.ts.
--
-- Nøklene er appenes egne sted-id-er (external_id), ikke radene i app_places:
-- et sted som arkiveres og kommer tilbake beholder koblingen sin.
-- Se docs/changelog/2026-10-06-akser-integrasjon.md, fase 5.

CREATE TABLE IF NOT EXISTS app_place_links (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	akser_place_id text NOT NULL,
	ekko_place_id text NOT NULL,
	status text NOT NULL,
	distance_meters integer,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_place_links_user_pair_idx
	ON app_place_links (user_id, akser_place_id, ekko_place_id);
