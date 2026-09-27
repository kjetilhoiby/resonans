-- Ro i stillhet: samme øvelser som Ro i bevegelse, men sittende (docs/ekko-ro.md).
-- `setting` er 'moving' eller 'still'. Eldre rader var alle i bevegelse.
ALTER TABLE ro_sessions ADD COLUMN IF NOT EXISTS setting text NOT NULL DEFAULT 'moving';
