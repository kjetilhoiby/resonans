-- Transport-grense per kappliste: maks bit som passer i bilen (default Tesla Model Y,
-- baksete nedfelt: ~1900 mm lengde × ~1000 mm bredde). Brukes til «kapp i butikk»-forslag.

ALTER TABLE cut_lists ADD COLUMN IF NOT EXISTS transport_max_length_mm double precision NOT NULL DEFAULT 1900;
ALTER TABLE cut_lists ADD COLUMN IF NOT EXISTS transport_max_width_mm double precision NOT NULL DEFAULT 1000;
