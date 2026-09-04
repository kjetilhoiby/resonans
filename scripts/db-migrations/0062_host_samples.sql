-- Vertens minne og last, samplet hvert minutt av cron-dispatcheren.
--
-- Finnes fordi nedetiden 3. september 2026 tok tre dager å forklare: maskinen
-- gikk tom for minne uten swap, og vi målte ingenting selv. Diagnosen ble til
-- slutt lest ut av dmesg i en webterminal på en telefon.
--
-- MÅ være en tabell, ikke en ringbuffer i minnet: hendelsen vi skal fange er
-- nettopp den der prosessen blir OOM-drept, og en minnebuffer ville mistet
-- akkurat det beviset.
CREATE TABLE IF NOT EXISTS host_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sampled_at timestamp NOT NULL DEFAULT now(),
  mem_total_kb integer NOT NULL,
  mem_available_kb integer NOT NULL,
  mem_free_kb integer NOT NULL,
  -- Page cache. Går denne mot null, thrasher maskinen. Ved OOM 4. september
  -- sto den på 1 388 kB mot ~1,4 GiB i normal drift.
  cached_kb integer NOT NULL,
  swap_total_kb integer NOT NULL,
  swap_free_kb integer NOT NULL,
  load1 real NOT NULL,
  load5 real NOT NULL,
  load15 real NOT NULL,
  -- Hvilken instans som målte. To rader samme minutt under rullende
  -- oppdatering er ikke en feil, det er to containere som ser samme vert.
  instance text
);

CREATE INDEX IF NOT EXISTS host_samples_sampled_at_idx ON host_samples (sampled_at DESC);
