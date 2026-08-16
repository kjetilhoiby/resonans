-- Svarteliste for treningsøkter: «denne økta skjedde ikke, uansett hvem som
-- forteller om den».
--
-- Fram til august 2026 var skjuling et flagg i `sensor_events.metadata`. Det er
-- riktig nivå for «denne RADEN», men feil nivå for «denne ØKTA», og forskjellen
-- ble konkret på tre måter i løpet av samme uke:
--
--   1. Synken overskrev metadata ved upsert, så flagget forsvant (rettet, men
--      det avslørte at flagget bor på et sted synken eier).
--   2. Brukeren slettet økta hos Withings — og den ble stående i Resonans, fordi
--      synken er additiv og ALDRI fjerner rader en kilde slutter å returnere.
--      En sletting ved kilden propagerer altså ikke.
--   3. En ny rad med revidert starttidspunkt ville fått ny id og dermed ikke
--      arvet flagget i det hele tatt.
--
-- Svartelista ligger utenfor `sensor_events` nettopp derfor: ingen synk skriver
-- her. Den matcher på TIDSPUNKT + SPORTSFAMILIE framfor på en rad-id, siden
-- poenget er å være uavhengig av hvilken kilde som beskriver økta.
--
-- Vi sletter fortsatt ingenting. Rader beholdes; de blir usynlige og teller
-- ikke. Se docs/changelog/2026-08-16-svarteliste-for-okter.md.

CREATE TABLE IF NOT EXISTS workout_suppressions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- Starttidspunktet til økta som ble skjult. Matching skjer innenfor et
	-- toleransevindu rundt denne, ikke på eksakt likhet: Withings reviderer
	-- økter retroaktivt, og andre kilder starter sporingen noen minutter unna.
	start_time timestamp NOT NULL,
	-- Normalisert sportsfamilie ('running', 'cycling', …). Uten den ville en
	-- svartelistet løpetur også skjult en sykkeltur på samme klokkeslett.
	sport_family text NOT NULL,
	-- Kun for diagnose og for å kunne vise brukeren hva som er skjult.
	source text,
	created_at timestamp NOT NULL DEFAULT now()
);

-- Oppslaget er alltid «alle svartelistinger for denne brukeren i dette
-- tidsrommet», gjort én gang per bygging av aktivitetslaget.
CREATE INDEX IF NOT EXISTS workout_suppressions_user_start_idx
	ON workout_suppressions (user_id, start_time DESC);

-- Samme økt skal ikke kunne svartelistes to ganger. Sekundpresis likhet holder
-- som sperre: gjentatte trykk på «Skjul» treffer den samme raden med det samme
-- tidsstempelet, mens en reell nabo-økt uansett fanges av toleransevinduet ved
-- matching.
CREATE UNIQUE INDEX IF NOT EXISTS workout_suppressions_user_start_family_idx
	ON workout_suppressions (user_id, start_time, sport_family);
