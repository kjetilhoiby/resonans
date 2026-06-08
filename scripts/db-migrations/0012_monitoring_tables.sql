-- Cron execution audit log
CREATE TABLE IF NOT EXISTS cron_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_path TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER,
    result_summary JSONB,
    error TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cron_exec_job_path_idx ON cron_executions (job_path, executed_at);

-- Monitoring alert dedup/history
CREATE TABLE IF NOT EXISTS monitoring_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_key TEXT NOT NULL UNIQUE,
    alert_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    message TEXT,
    last_fired_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    fire_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
