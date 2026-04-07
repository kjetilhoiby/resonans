CREATE TABLE IF NOT EXISTS background_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text REFERENCES users(id),
    type text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb,
    error text,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    priority integer NOT NULL DEFAULT 0,
    run_at timestamp NOT NULL DEFAULT now(),
    locked_at timestamp,
    locked_by text,
    started_at timestamp,
    finished_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS background_jobs_due_idx
    ON background_jobs (status, run_at, priority, created_at);

CREATE INDEX IF NOT EXISTS background_jobs_user_created_idx
    ON background_jobs (user_id, created_at);
