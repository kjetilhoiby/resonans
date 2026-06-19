-- Knytt en live-økt (typisk en kjøre-etappe, sportType='driving') til et reise-tema.
-- Lar Ekko sende med temaet en etappe hører til, slik at den avsluttede kjøreturen
-- kan berike temaets geo-kontekst (tripProfile.geoByDay). Nullbar: økter uten tema
-- (vanlig løp/sykkel-deling) er upåvirket.
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS theme_id uuid REFERENCES themes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS live_sessions_theme_idx ON live_sessions (theme_id);
