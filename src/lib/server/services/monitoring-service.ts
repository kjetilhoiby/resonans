import { db } from '$lib/db';
import { sensors, backgroundJobs, cronExecutions, monitoringAlerts } from '$lib/db/schema';
import { and, eq, gte, lt, sql, desc } from 'drizzle-orm';
import { sendGoogleChatMessage, type GoogleChatMessage } from '$lib/server/google-chat';
import { env } from '$env/dynamic/private';

const FRESHNESS_THRESHOLDS: Record<string, { maxStalenessMs: number; label: string }> = {
	withings: { maxStalenessMs: 6 * 3600_000, label: 'Withings' },
	sparebank1: { maxStalenessMs: 18 * 3600_000, label: 'SpareBank1' },
	dropbox: { maxStalenessMs: 2 * 3600_000, label: 'Dropbox' },
	spond: { maxStalenessMs: 48 * 3600_000, label: 'Spond' },
	strava: { maxStalenessMs: 48 * 3600_000, label: 'Strava' },
};

interface StaleSensor {
	provider: string;
	label: string;
	sensorId: string;
	lastSync: Date | null;
	lastError: string | null;
	hoursAgo: number;
}

interface FailingJobType {
	type: string;
	failed: number;
	completed: number;
	topError: string | null;
	lastFailedAt: Date | null;
}

interface CronMiss {
	jobPath: string;
	lastExecution: Date | null;
	lastStatus: string | null;
}

export interface HealthCheckResult {
	status: 'ok' | 'degraded' | 'failing';
	staleSensors: StaleSensor[];
	failingJobs: FailingJobType[];
	cronMisses: CronMiss[];
	timestamp: string;
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
	const [staleSensors, failingJobs, cronMisses] = await Promise.all([
		checkSensorFreshness(),
		checkBackgroundJobHealth(),
		checkCronExecutionHealth(),
	]);

	const hasProblems = staleSensors.length > 0 || failingJobs.length > 0 || cronMisses.length > 0;
	const status = hasProblems
		? (staleSensors.length > 0 || failingJobs.length > 0 ? 'failing' : 'degraded')
		: 'ok';

	return {
		status,
		staleSensors,
		failingJobs,
		cronMisses,
		timestamp: new Date().toISOString(),
	};
}

async function checkSensorFreshness(): Promise<StaleSensor[]> {
	const activeSensors = await db.query.sensors.findMany({
		where: eq(sensors.isActive, true),
		columns: { id: true, provider: true, lastSync: true, lastError: true },
	});

	const now = Date.now();
	const stale: StaleSensor[] = [];

	for (const sensor of activeSensors) {
		const threshold = FRESHNESS_THRESHOLDS[sensor.provider];
		if (!threshold) continue;

		const lastSyncMs = sensor.lastSync?.getTime() ?? 0;
		const age = now - lastSyncMs;

		if (age > threshold.maxStalenessMs) {
			stale.push({
				provider: sensor.provider,
				label: threshold.label,
				sensorId: sensor.id,
				lastSync: sensor.lastSync,
				lastError: sensor.lastError,
				hoursAgo: Math.round(age / 3600_000),
			});
		}
	}

	return stale;
}

async function checkBackgroundJobHealth(): Promise<FailingJobType[]> {
	const since = new Date(Date.now() - 24 * 3600_000);

	const rows = await db
		.select({
			type: backgroundJobs.type,
			status: backgroundJobs.status,
			error: backgroundJobs.error,
			finishedAt: backgroundJobs.finishedAt,
		})
		.from(backgroundJobs)
		.where(gte(backgroundJobs.createdAt, since));

	const byType = new Map<string, { failed: number; completed: number; errors: string[]; lastFailedAt: Date | null }>();

	for (const row of rows) {
		const entry = byType.get(row.type) ?? { failed: 0, completed: 0, errors: [], lastFailedAt: null };
		if (row.status === 'failed') {
			entry.failed++;
			if (row.error) entry.errors.push(row.error);
			if (!entry.lastFailedAt || (row.finishedAt && row.finishedAt > entry.lastFailedAt)) {
				entry.lastFailedAt = row.finishedAt;
			}
		} else if (row.status === 'completed') {
			entry.completed++;
		}
		byType.set(row.type, entry);
	}

	const failing: FailingJobType[] = [];
	for (const [type, stats] of byType) {
		const total = stats.failed + stats.completed;
		if (total > 0 && stats.failed / total > 0.25) {
			failing.push({
				type,
				failed: stats.failed,
				completed: stats.completed,
				topError: stats.errors[0] ?? null,
				lastFailedAt: stats.lastFailedAt,
			});
		}
	}

	return failing;
}

async function checkCronExecutionHealth(): Promise<CronMiss[]> {
	const expectedJobs: Record<string, number> = {
		'/api/cron/withings-sync': 30 * 60_000,
		'/api/cron/background-jobs': 30 * 60_000,
		'/api/cron/sparebank1-sync': 12 * 3600_000,
		'/api/cron/aggregate': 12 * 3600_000,
		'/api/cron/dropbox-sync': 30 * 60_000,
	};

	const misses: CronMiss[] = [];
	const now = Date.now();

	for (const [jobPath, maxAgeMs] of Object.entries(expectedJobs)) {
		const [latest] = await db
			.select({ executedAt: cronExecutions.executedAt, status: cronExecutions.status })
			.from(cronExecutions)
			.where(eq(cronExecutions.jobPath, jobPath))
			.orderBy(desc(cronExecutions.executedAt))
			.limit(1);

		if (!latest || now - latest.executedAt.getTime() > maxAgeMs) {
			misses.push({
				jobPath,
				lastExecution: latest?.executedAt ?? null,
				lastStatus: latest?.status ?? null,
			});
		}
	}

	return misses;
}

function formatHoursAgo(hours: number): string {
	if (hours < 1) return 'under 1 time';
	if (hours < 24) return `${hours}t`;
	const days = Math.floor(hours / 24);
	return `${days} dag${days > 1 ? 'er' : ''}`;
}

function formatDate(d: Date | null): string {
	if (!d) return 'aldri';
	return new Intl.DateTimeFormat('nb-NO', {
		day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
		timeZone: 'Europe/Oslo',
	}).format(d);
}

export function buildStatusSummary(result: HealthCheckResult): string {
	const date = new Intl.DateTimeFormat('nb-NO', {
		day: 'numeric', month: 'long', timeZone: 'Europe/Oslo'
	}).format(new Date());

	const problems = result.staleSensors.length + result.failingJobs.length + result.cronMisses.length;

	const lines: string[] = [];

	if (problems === 0) {
		lines.push(`✅ Resonans helsesjekk ${date}\n`);
		lines.push(`Integrasjoner: alle OK`);
		lines.push(`Bakgrunnsoppgaver: OK (24t)`);
		lines.push(`Cron-kjøringer: alle kjørt som planlagt`);
	} else {
		lines.push(`⚠️ Resonans helsesjekk ${date} — ${problems} problem${problems > 1 ? 'er' : ''}\n`);

		for (const s of result.staleSensors) {
			lines.push(`❌ ${s.label}: Ikke synket på ${formatHoursAgo(s.hoursAgo)} (sist: ${formatDate(s.lastSync)})`);
			if (s.lastError) lines.push(`   Feil: "${s.lastError}"`);
		}

		for (const j of result.failingJobs) {
			lines.push(`❌ Bakgrunnsoppgaver: ${j.failed}/${j.failed + j.completed} feilet siste 24t (${j.type})`);
		}

		for (const c of result.cronMisses) {
			lines.push(`❌ Cron mangler: ${c.jobPath} (sist: ${formatDate(c.lastExecution)})`);
		}
	}

	return lines.join('\n');
}

export async function buildDeepDiagnostics(result: HealthCheckResult): Promise<string> {
	const now = new Intl.DateTimeFormat('nb-NO', {
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo'
	}).format(new Date());

	const lines: string[] = [`Resonans systemhelse ${now}\n`];

	for (const s of result.staleSensors) {
		lines.push(`STALE: ${s.provider}`);
		lines.push(`- sensor_id: ${s.sensorId}`);
		lines.push(`- lastSync: ${s.lastSync?.toISOString() ?? 'null'} (${s.hoursAgo}t siden)`);
		lines.push(`- lastError: ${s.lastError ? `"${s.lastError}"` : 'null'}`);

		const recentExecs = await db
			.select({ executedAt: cronExecutions.executedAt, status: cronExecutions.status, durationMs: cronExecutions.durationMs, error: cronExecutions.error })
			.from(cronExecutions)
			.where(sql`${cronExecutions.jobPath} LIKE ${'%' + s.provider + '%'}`)
			.orderBy(desc(cronExecutions.executedAt))
			.limit(3);

		if (recentExecs.length > 0) {
			lines.push(`- siste ${recentExecs.length} cron_executions:`);
			for (const e of recentExecs) {
				const ts = formatDate(e.executedAt);
				lines.push(`  ${ts} → ${e.status} (${e.durationMs}ms)${e.error ? `: "${e.error}"` : ''}`);
			}
		}
		lines.push('');
	}

	if (result.failingJobs.length > 0) {
		lines.push('FAILING JOBS (24t):');
		for (const j of result.failingJobs) {
			lines.push(`- ${j.type}: ${j.failed} feilet, ${j.completed} fullført`);
			if (j.topError) lines.push(`  Vanligste feil: "${j.topError}"`);
			if (j.lastFailedAt) lines.push(`  Siste feilet: ${formatDate(j.lastFailedAt)}`);
		}
		lines.push('');
	}

	if (result.cronMisses.length > 0) {
		lines.push('MANGLENDE CRON-KJØRINGER:');
		for (const c of result.cronMisses) {
			lines.push(`- ${c.jobPath}: sist ${formatDate(c.lastExecution)} (${c.lastStatus ?? 'ukjent'})`);
		}
		lines.push('');
	}

	const recent24h = await db
		.select({
			jobPath: cronExecutions.jobPath,
			status: cronExecutions.status,
			count: sql<number>`count(*)`,
		})
		.from(cronExecutions)
		.where(gte(cronExecutions.executedAt, new Date(Date.now() - 24 * 3600_000)))
		.groupBy(cronExecutions.jobPath, cronExecutions.status);

	const cronSummary = new Map<string, { ok: number; error: number }>();
	for (const row of recent24h) {
		const entry = cronSummary.get(row.jobPath) ?? { ok: 0, error: 0 };
		if (row.status === 'success') entry.ok += Number(row.count);
		else entry.error += Number(row.count);
		cronSummary.set(row.jobPath, entry);
	}

	if (cronSummary.size > 0) {
		lines.push('CRON EXECUTIONS (24t):');
		for (const [path, stats] of cronSummary) {
			const total = stats.ok + stats.error;
			lines.push(`- ${path}: ${total} kjøringer, ${stats.error > 0 ? `${stats.error} feilet` : `${stats.ok} OK`}`);
		}
	}

	return lines.join('\n');
}

export async function sendMonitoringAlert(result: HealthCheckResult): Promise<boolean> {
	const webhookUrl = env.MONITORING_WEBHOOK_URL;
	if (!webhookUrl) {
		console.warn('[monitoring] MONITORING_WEBHOOK_URL ikke satt — hopper over Google Chat-varsel');
		return false;
	}

	const summary = buildStatusSummary(result);
	const hasProblems = result.status !== 'ok';

	let text = summary;

	if (hasProblems) {
		const diagnostics = await buildDeepDiagnostics(result);
		text += `\n\n📋 Kopier til Claude for feilsøking:\n\n---\n${diagnostics}\n---`;
	}

	const message: GoogleChatMessage = { text };
	return sendGoogleChatMessage(webhookUrl, message);
}
