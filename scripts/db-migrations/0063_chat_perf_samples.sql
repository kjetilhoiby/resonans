-- Fasemåling for chat-pipelinen, lagret framfor bare logget.
--
-- `[chat-perf]` har logget én linje per melding siden 2. september 2026, men
-- ringbufferen tømmes ved restart — og restart skjer ved hver push. Målingen
-- var derfor i praksis et vindu på noen timer, som krevde admin-secret å lese.
-- Spørsmålet den skal svare på (hvor går tida, hva er verdt å cache) besvares
-- av fordelingen over mange meldinger, ikke av én linje.
CREATE TABLE IF NOT EXISTS chat_perf_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measured_at timestamp NOT NULL DEFAULT now(),
  -- Tiden brukeren ventet på konteksten.
  wall_ms integer NOT NULL,
  -- Fasene: [{ "name": "helsebriefing", "ms": 412 }, …]. Navnene er
  -- kode-literaler og bærer ingen brukerdata, men leses gjennom en hviteliste
  -- (parsePhases) fordi jsonb er en generell beholder.
  phases jsonb NOT NULL DEFAULT '[]'::jsonb,
  instance text
);

CREATE INDEX IF NOT EXISTS chat_perf_samples_measured_at_idx
  ON chat_perf_samples (measured_at DESC);
