-- Quiz-fikser etter brukertest (bilquizen): pre-generert spørsmålsbank, idempotent vurdering
-- og gjentakelses-vern.
--
--   question_bank       jsonb-array av { id, player, text, answer, category, used } — banken
--                        genereres i batch (sterk modell) ved bekreftet lag; spilleturer TREKKER
--                        neste ubrukte i stedet for å generere on-the-fly.
--   current_question_id  id-en til gjeldende spørsmål (fra banken) — vurdering nøkles på denne.
--   question_state       'open' | 'answered' | NULL — statuskolonne som serialiserer vurderingen
--                        (én betinget UPDATE vinner; et allerede besvart spørsmål re-vurderes aldri).
--   asked_log            normalisert logg over alt som er stilt i quizen — refill av banken
--                        ekskluderer loggen fra brukerens siste quizer, så spørsmål ikke gjentas.
ALTER TABLE quiz_sessions
	ADD COLUMN IF NOT EXISTS current_question_id text,
	ADD COLUMN IF NOT EXISTS question_state text,
	ADD COLUMN IF NOT EXISTS question_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
	ADD COLUMN IF NOT EXISTS asked_log jsonb NOT NULL DEFAULT '[]'::jsonb;
