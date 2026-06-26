-- «Tilpass kapp til bil» som av/på per kappliste. Default på (feltet ble nettopp
-- innført), kan krysses vekk når transport ikke er relevant.

ALTER TABLE cut_lists ADD COLUMN IF NOT EXISTS transport_enabled boolean NOT NULL DEFAULT true;
