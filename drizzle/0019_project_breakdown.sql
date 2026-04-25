-- Prosjekt-utvidelse av tasks: nedbryting i steg, deadline, prosjekt-chat,
-- og filer knyttet direkte til en task. Maks ett nivå nesting håndheves
-- i applikasjonslaget.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS start_date timestamp,
    ADD COLUMN IF NOT EXISTS due_date timestamp,
    ADD COLUMN IF NOT EXISTS sort_order integer;

CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx ON tasks (parent_task_id);

CREATE TABLE IF NOT EXISTS task_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    url text NOT NULL,
    file_type text,
    mime_type text,
    size_bytes integer,
    created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_files_task_id_idx ON task_files (task_id);
