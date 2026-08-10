-- Fjerner `moving_seconds` igjen.
--
-- Kolonnen ble lagt til i 0053 for automatisk korreksjon av glemte sporinger:
-- effort skulle skåres på bevegelsestid i stedet for opptakstid. Den tilnærmingen
-- er forkastet. Målt mot prod endret den 96 økter for en feil som skjer et par
-- ganger i året, og tok feil på de fleste av dem — en løpetur der sporingen brøt
-- sammen ble til «8 min», en fjelltur mistet halvparten fordi bratt terreng er sakte.
--
-- Retningen er nå motsatt: Resonans FORESLÅR («ser ut som du glemte å stoppe»),
-- brukeren godkjenner i Ekko, og korreksjonen skjer ved at sporet kuttes og lastes
-- opp på nytt. Da er `duration` sann, og ingen kolonne trengs for å overstyre den.
--
-- 0053 beholdes framfor å slettes: den kjørte i prod 10. august, og en migrasjon
-- som har kjørt skal ikke forsvinne fra historikken.
--
-- Ingen data går tapt: kolonnen ble aldri backfillet, og ingenting leste den.

ALTER TABLE canonical_workouts
	DROP COLUMN IF EXISTS moving_seconds;
