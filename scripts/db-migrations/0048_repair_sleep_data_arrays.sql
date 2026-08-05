-- Reparer søvnrader der `data` ble en array i stedet for et objekt.
--
-- ÅRSAK
-- `syncSleepHrv` flettet HRV med
--     SET data = data || $1::jsonb
-- der $1 var `JSON.stringify({hrv})`. Parameteren nådde basen som en jsonb *streng*,
-- ikke et objekt, og i Postgres er `object || string` en KONKATENERING:
--     {"hr_min":50,…}  ||  "{\"hrv\":…}"   →   [{"hr_min":50,…}, "{\"hrv\":…}"]
--
-- Verre: `data -> 'hrv'` er NULL på en array, så raden ble aldri regnet som ferdig.
-- Synken kjører hvert 5. minutt og la på én streng til hver gang — prod-rader hadde
-- attende elementer 5. august.
--
-- KONSEKVENS
-- Alle felt i det opprinnelige objektet ble utilgjengelige for lesere: `hr_min`,
-- `hr_average`, `sleepDuration`, `isNap`. Det ga «ingen sovepuls målt ennå», «ingen
-- netter med HRV», og dupper som viste 0 min — selv om verdiene lå der, i element 0.
--
-- REPARASJONEN
-- Element 0 er det opprinnelige objektet. De påfølgende strengene forkastes framfor å
-- pakkes ut: samme HRV-verdi ble limt på hvert segment av natta *og* på dagsøvner som
-- aldri hadde HRV, så innholdet er ikke til å stole på. `syncSleepHrv` henter dem på
-- nytt — den er selvhelende over 21 dager, og skriver nå med `jsonb_build_object`.
--
-- Idempotent: treffer bare rader som faktisk er arrayer med et objekt i element 0.

UPDATE sensor_events
SET data = data -> 0
WHERE data_type = 'sleep'
  AND jsonb_typeof(data) = 'array'
  AND jsonb_typeof(data -> 0) = 'object';
