/**
 * Applies migration 0041_context_storage_redesign and migrates existing
 * memories.source rows into the new tables (reflections, plan_artifacts,
 * goal_tracks) plus themes.instructions and theme_files.parsed_content.
 *
 * Idempotent: re-running skips already-migrated rows.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => {
		try {
			readFileSync(p);
			return true;
		} catch {
			return false;
		}
	});

if (!envPath) {
	console.error('No .env or .env.local found');
	process.exit(1);
}

readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
	const [k, ...v] = line.split('=');
	if (!k || process.env[k]) return;
	process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const DDL_STATEMENTS = [
	`ALTER TABLE "themes" ADD COLUMN IF NOT EXISTS "instructions" text`,
	`ALTER TABLE "theme_files" ADD COLUMN IF NOT EXISTS "parsed_content" text`,
	`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confidence" text NOT NULL DEFAULT 'user_confirmed'`,
	`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source_ref" jsonb`,
	`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "superseded_by" uuid`,
	`CREATE TABLE IF NOT EXISTS "reflections" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
		"theme_id" uuid REFERENCES "themes"("id") ON DELETE SET NULL,
		"person_id" uuid REFERENCES "persons"("id") ON DELETE SET NULL,
		"kind" text NOT NULL,
		"period_key" text,
		"content" text NOT NULL,
		"scores" jsonb,
		"flow_run_id" text,
		"created_at" timestamp DEFAULT now() NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS "reflections_user_created_idx" ON "reflections"("user_id","created_at")`,
	`CREATE INDEX IF NOT EXISTS "reflections_user_kind_period_idx" ON "reflections"("user_id","kind","period_key")`,
	`CREATE TABLE IF NOT EXISTS "plan_artifacts" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
		"theme_id" uuid REFERENCES "themes"("id") ON DELETE SET NULL,
		"kind" text NOT NULL,
		"period_key" text NOT NULL,
		"parent_period_key" text,
		"headline" text,
		"note" text,
		"reflection" text,
		"vision" text,
		"goal_refs" jsonb,
		"status" text NOT NULL DEFAULT 'active',
		"created_at" timestamp DEFAULT now() NOT NULL,
		"updated_at" timestamp DEFAULT now() NOT NULL,
		"closed_at" timestamp
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS "plan_artifacts_user_kind_period_uq" ON "plan_artifacts"("user_id","kind","period_key")`,
	`CREATE INDEX IF NOT EXISTS "plan_artifacts_user_parent_idx" ON "plan_artifacts"("user_id","parent_period_key")`,
	`CREATE TABLE IF NOT EXISTS "context_briefs" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
		"kind" text NOT NULL,
		"scope_start" timestamp NOT NULL,
		"scope_end" timestamp NOT NULL,
		"summary" text NOT NULL,
		"highlights" jsonb,
		"inputs" jsonb,
		"goal_ids" uuid[],
		"theme_ids" uuid[],
		"model" text,
		"prompt_version" text,
		"relevance_until" timestamp,
		"superseded_by" uuid,
		"created_at" timestamp DEFAULT now() NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS "context_briefs_user_kind_created_idx" ON "context_briefs"("user_id","kind","created_at")`,
	`CREATE INDEX IF NOT EXISTS "context_briefs_user_relevance_idx" ON "context_briefs"("user_id","relevance_until")`,
	`CREATE TABLE IF NOT EXISTS "goal_tracks" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
		"metric_id" text NOT NULL,
		"tracks" jsonb NOT NULL DEFAULT '[]'::jsonb,
		"updated_at" timestamp DEFAULT now() NOT NULL,
		"created_at" timestamp DEFAULT now() NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS "goal_tracks_user_metric_uq" ON "goal_tracks"("user_id","metric_id")`
];

const stats = {
	planArtifactsUpserted: 0,
	reflectionsInserted: 0,
	goalTracksUpserted: 0,
	themeInstructionsCopied: 0,
	themeFileContentsCopied: 0,
	nudgeClicksDeleted: 0,
	memoriesDeleted: 0
};

try {
	for (const stmt of DDL_STATEMENTS) {
		await sql.unsafe(stmt);
	}
	console.log('✅ DDL applied');

	// month-plan: note / reflection / vision → plan_artifacts
	const monthPlanRows = await sql`
		SELECT id, user_id, theme_id, content, source, created_at, updated_at
		FROM memories
		WHERE source LIKE 'month-plan:%'
	`;
	for (const row of monthPlanRows) {
		const m = String(row.source).match(/^month-plan:([^:]+):(note|reflection|vision)$/);
		if (!m) continue;
		const periodKey = m[1];
		const field = m[2];
		await sql`
			INSERT INTO plan_artifacts (user_id, theme_id, kind, period_key, ${sql(field)}, created_at, updated_at)
			VALUES (${row.user_id}, ${row.theme_id}, 'month', ${periodKey}, ${row.content}, ${row.created_at}, ${row.updated_at})
			ON CONFLICT (user_id, kind, period_key) DO UPDATE SET ${sql(field)} = EXCLUDED.${sql(field)}, updated_at = EXCLUDED.updated_at
		`;
		stats.planArtifactsUpserted += 1;
	}

	// week-plan: note / reflection / vision → plan_artifacts
	const weekPlanRows = await sql`
		SELECT id, user_id, theme_id, content, source, created_at, updated_at
		FROM memories
		WHERE source ~ '^week-plan:[^:]+:(note|reflection|vision)$'
	`;
	for (const row of weekPlanRows) {
		const m = String(row.source).match(/^week-plan:([^:]+):(note|reflection|vision)$/);
		if (!m) continue;
		const periodKey = m[1];
		const field = m[2];
		await sql`
			INSERT INTO plan_artifacts (user_id, theme_id, kind, period_key, ${sql(field)}, created_at, updated_at)
			VALUES (${row.user_id}, ${row.theme_id}, 'week', ${periodKey}, ${row.content}, ${row.created_at}, ${row.updated_at})
			ON CONFLICT (user_id, kind, period_key) DO UPDATE SET ${sql(field)} = EXCLUDED.${sql(field)}, updated_at = EXCLUDED.updated_at
		`;
		stats.planArtifactsUpserted += 1;
	}

	// week-plan day note / headline → plan_artifacts (kind='day')
	const dayRows = await sql`
		SELECT id, user_id, theme_id, content, source, created_at, updated_at
		FROM memories
		WHERE source ~ '^week-plan:[^:]+:day:[^:]+:(note|headline)$'
	`;
	for (const row of dayRows) {
		const m = String(row.source).match(/^week-plan:([^:]+):day:([^:]+):(note|headline)$/);
		if (!m) continue;
		const weekKey = m[1];
		const dayIso = m[2];
		const field = m[3];
		await sql`
			INSERT INTO plan_artifacts (user_id, theme_id, kind, period_key, parent_period_key, ${sql(field)}, created_at, updated_at)
			VALUES (${row.user_id}, ${row.theme_id}, 'day', ${dayIso}, ${weekKey}, ${row.content}, ${row.created_at}, ${row.updated_at})
			ON CONFLICT (user_id, kind, period_key) DO UPDATE SET ${sql(field)} = EXCLUDED.${sql(field)}, parent_period_key = EXCLUDED.parent_period_key, updated_at = EXCLUDED.updated_at
		`;
		stats.planArtifactsUpserted += 1;
	}

	// salary_reflection_{month} → reflections
	const salaryRows = await sql`
		SELECT id, user_id, theme_id, content, source, created_at
		FROM memories
		WHERE source LIKE 'salary_reflection_%'
	`;
	for (const row of salaryRows) {
		const periodKey = String(row.source).replace(/^salary_reflection_/, '') || null;
		await sql`
			INSERT INTO reflections (user_id, theme_id, kind, period_key, content, created_at)
			VALUES (${row.user_id}, ${row.theme_id}, 'salary_report', ${periodKey}, ${row.content}, ${row.created_at})
		`;
		stats.reflectionsInserted += 1;
	}

	// goal_tracks_v1 → goal_tracks (split per metric)
	const trackRows = await sql`
		SELECT id, user_id, content, created_at, updated_at
		FROM memories
		WHERE source = 'goal_tracks_v1'
	`;
	for (const row of trackRows) {
		let parsed = null;
		try {
			parsed = JSON.parse(String(row.content));
		} catch {
			console.warn(`Skipping invalid goal_tracks_v1 JSON for memory ${row.id}`);
			continue;
		}
		if (!parsed || typeof parsed !== 'object') continue;
		for (const [metricId, tracks] of Object.entries(parsed)) {
			if (!Array.isArray(tracks)) continue;
			await sql`
				INSERT INTO goal_tracks (user_id, metric_id, tracks, created_at, updated_at)
				VALUES (${row.user_id}, ${metricId}, ${JSON.stringify(tracks)}::jsonb, ${row.created_at}, ${row.updated_at})
				ON CONFLICT (user_id, metric_id) DO UPDATE SET tracks = EXCLUDED.tracks, updated_at = EXCLUDED.updated_at
			`;
			stats.goalTracksUpserted += 1;
		}
	}

	// theme_instruction → themes.instructions
	const instructionRows = await sql`
		SELECT user_id, theme_id, content
		FROM memories
		WHERE source = 'theme_instruction' AND theme_id IS NOT NULL
	`;
	for (const row of instructionRows) {
		await sql`UPDATE themes SET instructions = ${row.content} WHERE id = ${row.theme_id} AND user_id = ${row.user_id}`;
		stats.themeInstructionsCopied += 1;
	}

	// theme_file:{fileId} → theme_files.parsed_content
	const fileRows = await sql`
		SELECT user_id, content, source
		FROM memories
		WHERE source LIKE 'theme_file:%'
	`;
	for (const row of fileRows) {
		const fileId = String(row.source).replace(/^theme_file:/, '');
		if (!fileId) continue;
		await sql`UPDATE theme_files SET parsed_content = ${row.content} WHERE id = ${fileId} AND user_id = ${row.user_id}`;
		stats.themeFileContentsCopied += 1;
	}

	// Drop migrated and obsolete memories rows
	const nudgeDel = await sql`DELETE FROM memories WHERE source LIKE 'nudge:click:%' RETURNING 1`;
	stats.nudgeClicksDeleted = nudgeDel.length;

	const migrated = await sql`
		DELETE FROM memories
		WHERE source LIKE 'month-plan:%'
			OR source ~ '^week-plan:[^:]+:(note|reflection|vision)$'
			OR source ~ '^week-plan:[^:]+:day:[^:]+:(note|headline)$'
			OR source LIKE 'salary_reflection_%'
			OR source = 'goal_tracks_v1'
			OR source = 'theme_instruction'
			OR source LIKE 'theme_file:%'
		RETURNING 1
	`;
	stats.memoriesDeleted = migrated.length;

	console.log('✅ Migration 0041 complete:', stats);
} catch (err) {
	console.error('Migration failed:', err);
	process.exit(1);
} finally {
	await sql.end();
}
