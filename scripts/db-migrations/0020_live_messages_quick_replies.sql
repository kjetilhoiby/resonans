-- Hurtigsvar for hands-free Ekko-bruker: seer→løper-meldinger får et binært
-- svarsett (to korte forslag) som Ekko viser som nikk/rist-knapper. LLM-parset
-- ved skriving og lagret på raden, slik at polling ikke trigger nye LLM-kall.
-- NULL = ingen forslag (f.eks. ren heiarop som ikke trenger svar).

ALTER TABLE live_session_messages
	ADD COLUMN IF NOT EXISTS quick_replies jsonb;
