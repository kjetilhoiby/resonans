-- Øktas tid delt i rolig / grått / kvalitet, i SEKUNDER.
--
-- Ligger ved siden av hr_zone_distribution, ikke i stedet for den: andelene
-- per sone kan ikke svare på om tida over terskel kom i SAMMENHENGENDE
-- blokker, og det er nettopp det skillet mellom «fire bakker på en rolig tur»
-- og «4×4 minutter» hviler på. Blokkstrukturen er borte i det andelene er
-- regnet, så den må måles mot punktene og lagres for seg.
--
-- Feltet bærer sin egen baseline (rest_hr/max_hr inni jsonb-objektet) av samme
-- grunn som sonefordelingen: tallene er bøttet av båndene som gjaldt DA økta
-- ble analysert.
--
-- Eksisterende rader får NULL. Historikken fylles av
-- POST /api/sensors/workouts/reanalyze.
ALTER TABLE canonical_workouts
	ADD COLUMN IF NOT EXISTS intensity_split jsonb;
