-- Dedup av øktvarsler på tvers av kilder.
--
-- Samme løpetur skrives av opptil tre sensorer (Withings-klokka, GPX-fila fra
-- Dropbox, Ekko-opplastingen). Nå som alle tre inngangene kan varsle, må én
-- reell økt fortsatt gi ett varsel. Raden skrives per KILDE, ikke per klynge:
-- klyngens id er dens eldste evidence-event, og den flytter seg hvis en kilde
-- med tidligere tidsstempel lander etterpå. Én rad per kilde gjør oppslaget
-- immunt mot det.

CREATE TABLE IF NOT EXISTS workout_notifications (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	sensor_event_id uuid NOT NULL,
	activity_id uuid NOT NULL,
	source text,
	notified_at timestamp NOT NULL DEFAULT now(),
	created_at timestamp NOT NULL DEFAULT now()
);

-- Sperra selve dedupen hviler på: samme hendelse kan bare bokføres én gang.
CREATE UNIQUE INDEX IF NOT EXISTS workout_notifications_user_event_idx
	ON workout_notifications (user_id, sensor_event_id);

-- Oppslaget går på «er noen av disse hendelsene varslet om?» for én bruker.
CREATE INDEX IF NOT EXISTS workout_notifications_user_notified_idx
	ON workout_notifications (user_id, notified_at DESC);
