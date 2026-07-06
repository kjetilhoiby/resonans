-- Rutebibliotek: navngitte, gjenbrukbare treningsruter (pendlerunde, vannrunden,
-- bakkeintervaller osv.) med fartsvarianter. Effort per variant BEREGNES fra
-- rutens fysiske fakta + variantens fart/reps (ikke lagret), så tallene holder
-- seg konsistente med effort-modellen. Noen ruter vil senere kobles til Ekko-
-- ruter via ekko_route_id.
-- Se docs/changelog/2026-07-05-treningslop.md.

CREATE TABLE IF NOT EXISTS training_routes (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	-- 'run' | 'bike' | 'hill' | 'trail' | 'mixed'
	kind text NOT NULL,
	distance_meters integer,
	elevation_meters integer,
	terrain text,
	notes text,
	-- Fartsvarianter/intervall-oppsett: [{ label, paceSecPerKm?, reps?, repDistanceMeters? }]
	variants jsonb NOT NULL DEFAULT '[]'::jsonb,
	-- Kobling til Ekko-rute (fylles når ruten finnes der). Ingen sync ennå.
	ekko_route_id text,
	archived boolean NOT NULL DEFAULT false,
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_routes_user_idx
	ON training_routes (user_id, archived, sort_order);
