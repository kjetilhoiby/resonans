-- Add unique constraint on program_readiness_assessments (userId, programId, assessmentDate)
-- Drizzle push can't add this non-interactively because the table already has rows.
-- First deduplicate any existing rows, keeping the most recent per (userId, programId, assessmentDate).
DELETE FROM program_readiness_assessments
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, program_id, assessment_date) id
    FROM program_readiness_assessments
    ORDER BY user_id, program_id, assessment_date, created_at DESC
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'program_readiness_user_program_date_uniq'
    ) THEN
        ALTER TABLE program_readiness_assessments
            ADD CONSTRAINT program_readiness_user_program_date_uniq
            UNIQUE (user_id, program_id, assessment_date);
    END IF;
END $$;
