-- Fjern HRV som ble stemplet på dagsøvner.
--
-- ÅRSAK
-- `nightKeyForTime` har kveldsgrense 18:00: en dupp kl. 14 og natta som endte den
-- morgenen havner i SAMME nattbøtte. `syncSleepHrv` grupperte på den nøkkelen og skrev
-- nattas HRV til hvert medlem av bøtta — også duppen.
--
-- Prod 5. august: duppen 2026-08-02T12:20Z hadde `{"sdnnMs":54,"samples":89}`, bytelikt
-- med natta 2026-08-01T21:37Z. Og siden `pickHrvMetric` dedupliserer på dato, kunne
-- duppen overskrive nattas ekte verdi.
--
-- Synken filtrerer nå bort naps, og `readNightlyPhysiology` hopper over dem. Dette
-- rydder radene som alt fikk verdien.
--
-- Idempotent: treffer bare naps som faktisk har en hrv-nøkkel.

UPDATE sensor_events
SET data = data - 'hrv'
WHERE data_type = 'sleep'
  AND jsonb_typeof(data) = 'object'
  AND (data ->> 'isNap') = 'true'
  AND data ? 'hrv';
