-- Arrangementer — konsert, teater, kamp, forestilling.
--
-- Ikke en task: en billett er kjøpt, datoen er fastsatt av noen andre, og det
-- som gjenstår er forberedelsene rundt den (transport, barnevakt, overnatting).
-- Derfor en egen tabell framfor et checklist_item med en dato på seg.
--
-- NB om tid: `event_date` er en DATE og `start_time`/`doors_time` er tekst i
-- HH:MM — Oslo-veggklokke, aldri et UTC-tidsstempel. En konsert 19:00 i Oslo
-- lagret som timestamp ville flyttet seg en dag over UTC-midnatt om sommeren
-- (samme felle som natta som ble delt av UTC-midnatt i søvnloggen), og en
-- billett sier «19:00», ikke «17:00Z».

CREATE TABLE IF NOT EXISTS events (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title text NOT NULL,
	kind text,                      -- 'konsert' | 'teater' | 'kino' | 'sport' | 'annet'
	event_date date NOT NULL,       -- Oslo-dato
	end_date date,                  -- satt bare for flerdagsarrangementer
	start_time text,                -- 'HH:MM' Oslo-veggklokke, null = tidspunkt ukjent
	doors_time text,                -- 'HH:MM' dørene åpner
	venue text,                     -- spillested
	address text,
	entrance text,                  -- «Inngang C», «Port 2»
	seat text,                      -- «Rad 12, sete 5»
	ticket_count integer,
	booking_reference text,
	notes text,
	tickets jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, publicId, kind, name, mimeType, addedAt}]
	prep jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{id, label, done, doneAt, note}]
	extracted jsonb,                -- rå uttrekk fra billett-lesingen, for etterprøving
	extraction_source text,         -- 'image' | 'pdf' | 'text' | 'manual'
	theme_id uuid REFERENCES themes(id) ON DELETE SET NULL,
	status text NOT NULL DEFAULT 'planned',       -- 'planned' | 'cancelled'
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_user_date_idx ON events (user_id, event_date);
