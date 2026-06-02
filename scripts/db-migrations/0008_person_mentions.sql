-- Person-mention-indekser: hvilke personer som er nevnt i meldinger, tasks og
-- checklist-items. Tabellene har ligget i schema.ts uten en eksplisitt SQL-
-- migrasjon, og drizzle push har historisk skippet additive tabeller stille
-- (jf. Ekko v1.1 / PR #89). Den samlede familie-feeden spør disse tabellene
-- direkte i hoved-loaderen, så de MÅ eksistere — denne migrasjonen sikrer det.
-- Alt er idempotent (IF NOT EXISTS) og en no-op der tabellene allerede finnes.

CREATE TABLE IF NOT EXISTS message_person_mentions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
	confidence text NOT NULL DEFAULT 'inferred',
	created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS message_person_mentions_msg_person_unique
	ON message_person_mentions (message_id, person_id);
CREATE INDEX IF NOT EXISTS message_person_mentions_person_created_idx
	ON message_person_mentions (person_id, created_at);
CREATE INDEX IF NOT EXISTS message_person_mentions_user_created_idx
	ON message_person_mentions (user_id, created_at);

CREATE TABLE IF NOT EXISTS task_person_mentions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
	confidence text NOT NULL DEFAULT 'inferred',
	created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_person_mentions_task_person_unique
	ON task_person_mentions (task_id, person_id);
CREATE INDEX IF NOT EXISTS task_person_mentions_person_created_idx
	ON task_person_mentions (person_id, created_at);

CREATE TABLE IF NOT EXISTS checklist_item_person_mentions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	checklist_item_id uuid NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
	person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
	confidence text NOT NULL DEFAULT 'inferred',
	created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_item_person_mentions_unique
	ON checklist_item_person_mentions (checklist_item_id, person_id);
CREATE INDEX IF NOT EXISTS checklist_item_person_mentions_person_created_idx
	ON checklist_item_person_mentions (person_id, created_at);
