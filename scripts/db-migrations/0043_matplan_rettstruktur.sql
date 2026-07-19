-- Matplan: strukturér middager som sammensetninger + ønsker-mer/effort-dimensjoner.
-- Komponert rett = fyller hovedprotein/hovedkarb/grønt (kan generere varianter ved bytte).
-- Komplett rett (suppe, taco, pizza, pannekaker) lar feltene stå tomme og oppfører seg som før.
-- want_more løfter retten i forslag/middagstinder; effort_level markerer innsatsnivå.
-- Næring dekkes av eksisterende nutrition_estimate — ingen ny kolonne der.

ALTER TABLE meals ADD COLUMN IF NOT EXISTS main_protein text;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS main_carb text;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS greens text;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS want_more boolean NOT NULL DEFAULT false;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS effort_level text; -- 'lav' | 'middels' | 'høy'
