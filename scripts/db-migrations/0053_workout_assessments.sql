-- Cache for LLM-vurderingen av en treningsøkt.
--
-- Fram til august 2026 ble vurderingen generert på nytt ved HVERT sidebesøk, med
-- temperatur 0.6 og et blokkerende kall i `load`. Samme økt fikk altså ulik tekst
-- hver gang du åpnet den, og sida ventet på OpenAI før den rendret.
--
-- `context_hash` er nøkkelen til at cachen ikke blir feil: den hashes av selve
-- konteksten som gikk inn i prompten. Endrer noe seg — Ekko-analysen lander
-- etterpå, et mål flytter seg, effort reberegnes — endres hashen, og vurderingen
-- skrives på nytt. Uten den ville en cache låst inne en vurdering fra før
-- halvparten av dataene fantes.

CREATE TABLE IF NOT EXISTS workout_assessments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	sensor_event_id uuid NOT NULL,
	assessment text NOT NULL,
	model text,
	context_hash text NOT NULL,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

-- Én vurdering per økt per bruker; den overskrives når konteksten endrer seg.
CREATE UNIQUE INDEX IF NOT EXISTS workout_assessments_user_event_idx
	ON workout_assessments (user_id, sensor_event_id);
