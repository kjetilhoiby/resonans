-- Matplan-onboarding: familiens ukerytme (fritekst AI-motorene leser) og et
-- onboarding-stempel så oppsett-wizarden ikke maser etter fullført/hoppet over.

ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS week_rhythm_note text;
ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS onboarded_at timestamp;
