-- Streaks — «hvor mange runder på rad har jeg holdt?»
--
-- Én tabell dekker tre semantikker, så alle streaks kan vises med samme visuelle
-- språk (flamme + teller) i stedet for hver sin widget:
--   consecutive_days   dager på rad med hendelse         «yoga 6 dager på rad»
--   count_per_window   perioder på rad over en terskel   «3 uker på rad med ≥2 løpeturer»
--   max_interval       runder på rad innen et intervall  «5 hårklipp på rad innen 5 dager»
--
-- Periodisk vedlikehold (max_interval) er bevisst modellert som streak, ikke som
-- nedtellingsklokke. Forfallsinformasjonen brukes til å løfte oppgaven fram på
-- ukeplanen før streaken brytes — streakens forsvar, ikke mas.
--
-- Ingen lagret teller: streaken beregnes on-demand fra hendelser
-- (canonical_workouts / sensor_events), på samme måte som målprogresjon.
-- Regel-semantikken bor i src/lib/domain/streaks.ts.

CREATE TABLE IF NOT EXISTS streak_definitions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title text NOT NULL,                              -- "Yoga", "Hårklipp", "Løping"
	emoji text NOT NULL DEFAULT '🔥',
	rule text NOT NULL,                               -- 'consecutive_days' | 'count_per_window' | 'max_interval'
	-- Hendelseskilde: { kind: 'workout', sportFamily } | { kind: 'sensor_event', dataType, textMatch? } | { kind: 'manual' }
	source jsonb NOT NULL,
	-- Regelparametre: { windowDays?, threshold?, intervalDays?, dueSoonDays? }
	config jsonb NOT NULL DEFAULT '{}'::jsonb,
	active boolean NOT NULL DEFAULT true,
	sort_order integer NOT NULL DEFAULT 0,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,      -- { themeId? }
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS streak_definitions_user_idx
	ON streak_definitions (user_id, active);
