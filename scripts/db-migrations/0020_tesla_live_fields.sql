-- Kjøretøy-telemetri på live-økter: lar Tesla-sync mate batteri/rekkevidde/lading
-- inn i en aktiv kjøre-økt (sportType='driving') som vises på det delte kartet.
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS battery_percent integer;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS range_km double precision;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS charging boolean;
