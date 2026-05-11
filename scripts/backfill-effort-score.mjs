/**
 * backfill-effort-score.mjs
 *
 * Populerer effort_score + effort_method på canonical_workouts for alle brukere.
 *
 * Etter at scriptet er kjørt, må weekly aggregates regenereres slik at
 * sensor_aggregates.metrics.weeklyEffort blir fylt ut. Det enkleste er å
 * trigge cron-endepunktet:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" $ORIGIN/api/cron/aggregate
 *
 * Bruk:
 *   export DATABASE_URL=...
 *   node scripts/backfill-effort-score.mjs [--dry-run] [--user=<userId>]
 *
 * Idempotent — kan kjøres på nytt uten bivirkninger.
 */

import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');
const userArg = process.argv.find((arg) => arg.startsWith('--user='));
const ONLY_USER = userArg ? userArg.split('=')[1] : null;

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL mangler');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 3, ssl: 'require' });

// ─── Effort-konstanter (skal speile effort-service.ts) ──────────────────────

const MIN_DURATION_SECONDS = 5 * 60;
const DEFAULT_REST_HR = 60;
const DEFAULT_MAX_HR = 190;
const MET_CALIBRATION = 2.5;

const MET_FACTOR_BY_FAMILY = {
	running: 1.0,
	cycling: 0.85,
	ebike: 0.4,
	strength: 0.7,
	yoga: 0.35,
	walking: 0.3,
	hiking: 0.55,
	swimming: 0.95,
	other: 0.5
};

function classifyEffortFamily(sportType, sportFamily) {
	const t = (sportType ?? '').trim().toLowerCase();
	const f = (sportFamily ?? '').trim().toLowerCase();
	if (t === 'e_bike' || t === 'ebike' || t.includes('e-bike')) return 'ebike';
	if (t.includes('running') || t === 'løp' || t === 'run' || t === 'løping') return 'running';
	if (t.includes('cycling') || t === 'sykkel' || t === 'bike') return 'cycling';
	if (t.includes('strength') || t.includes('styrke') || t === 'gym') return 'strength';
	if (t.includes('yoga') || t.includes('pilates') || t === 'mikroyoga') return 'yoga';
	if (t.includes('walking') || t === 'gå' || t === 'gåtur') return 'walking';
	if (t.includes('hiking') || t.includes('fjelltur')) return 'hiking';
	if (t.includes('swimming') || t === 'svømming') return 'swimming';
	if (f === 'running' || f === 'cycling' || f === 'walking' || f === 'swimming') return f;
	return 'other';
}

function computeWorkoutEffort(input, baseline) {
	const dur = typeof input.durationSeconds === 'number' ? input.durationSeconds : null;
	if (!dur || dur < MIN_DURATION_SECONDS) return null;
	const durMin = dur / 60;
	const family = classifyEffortFamily(input.sportType, input.sportFamily);
	const avgHr = typeof input.avgHeartRate === 'number' && input.avgHeartRate > 0 ? input.avgHeartRate : null;
	const hasUsableHr = avgHr !== null && baseline.maxHr > baseline.restHr;

	if (hasUsableHr) {
		const hrrRaw = (avgHr - baseline.restHr) / (baseline.maxHr - baseline.restHr);
		const hrr = Math.max(0, Math.min(1, hrrRaw));
		const k = 0.64 * Math.exp(1.92 * hrr);
		const score = durMin * hrr * k;
		if (score < 1) {
			return { score: round1(durMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION), method: 'met' };
		}
		return { score: round1(score), method: 'trimp' };
	}

	return { score: round1(durMin * MET_FACTOR_BY_FAMILY[family] * MET_CALIBRATION), method: 'met' };
}

function round1(v) {
	return Math.round(v * 10) / 10;
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function computeBaseline(userId) {
	const rows = await sql`
		SELECT data
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND timestamp >= NOW() - INTERVAL '30 days'
	`;
	const hrMins = [];
	const hrMaxes = [];
	for (const row of rows) {
		const data = row.data ?? {};
		const hrMin = typeof data.hr_min === 'number' ? data.hr_min : null;
		const hrMax = typeof data.hr_max === 'number' ? data.hr_max : null;
		const hrAvg = typeof data.hr_average === 'number' ? data.hr_average : null;
		const wAvg = typeof data.avgHeartRate === 'number' ? data.avgHeartRate : null;
		const wMax = typeof data.maxHeartRate === 'number' ? data.maxHeartRate : null;
		if (hrMin && hrMin > 30 && hrMin < 120) hrMins.push(hrMin);
		if (hrMax && hrMax > 100 && hrMax < 230) hrMaxes.push(hrMax);
		if (wMax && wMax > 100 && wMax < 230) hrMaxes.push(wMax);
		if (wAvg && wAvg > 100 && wAvg < 220) hrMaxes.push(wAvg * 1.05);
		if (hrAvg && hrAvg > 30 && hrAvg < 80) hrMins.push(hrAvg);
	}
	let restHr = DEFAULT_REST_HR;
	let maxHr = DEFAULT_MAX_HR;
	if (hrMins.length >= 3) restHr = median(hrMins);
	if (hrMaxes.length >= 1) maxHr = Math.min(220, Math.max(...hrMaxes));
	if (maxHr - restHr < 60) maxHr = restHr + 60;
	return { restHr: Math.round(restHr), maxHr: Math.round(maxHr) };
}

// ─── Hovedlogikk ─────────────────────────────────────────────────────────────

async function main() {
	const users = ONLY_USER
		? [{ id: ONLY_USER }]
		: await sql`
			SELECT DISTINCT user_id AS id
			FROM canonical_workouts
		`;
	console.log(`Behandler ${users.length} bruker(e)${DRY_RUN ? ' (DRY-RUN)' : ''}`);

	let totalUpdated = 0;
	let totalSkipped = 0;

	for (const user of users) {
		const baseline = await computeBaseline(user.id);
		console.log(`  ${user.id}: restHr=${baseline.restHr}, maxHr=${baseline.maxHr}`);

		const workouts = await sql`
			SELECT id, sport_type, sport_family, duration_seconds, avg_heart_rate
			FROM canonical_workouts
			WHERE user_id = ${user.id}
		`;

		const updates = [];
		for (const w of workouts) {
			const durationSeconds = w.duration_seconds !== null ? Number(w.duration_seconds) : null;
			const avgHeartRate = w.avg_heart_rate !== null ? Number(w.avg_heart_rate) : null;
			const effort = computeWorkoutEffort(
				{
					sportType: w.sport_type,
					sportFamily: w.sport_family,
					durationSeconds,
					avgHeartRate
				},
				baseline
			);
			if (effort) {
				updates.push({ id: w.id, score: effort.score, method: effort.method });
			} else {
				totalSkipped += 1;
			}
		}

		if (!DRY_RUN && updates.length > 0) {
			// Batch oppdater i grupper på 200 for å unngå store query-payloads
			for (let i = 0; i < updates.length; i += 200) {
				const batch = updates.slice(i, i + 200);
				await sql.begin(async (tx) => {
					for (const u of batch) {
						await tx`
							UPDATE canonical_workouts
							SET effort_score = ${u.score}, effort_method = ${u.method}, updated_at = NOW()
							WHERE id = ${u.id}
						`;
					}
				});
			}
		}

		totalUpdated += updates.length;
		console.log(`    → ${updates.length} oppdatert, ${workouts.length - updates.length} forbigått`);
	}

	console.log('');
	console.log(`Ferdig. ${totalUpdated} økter oppdatert, ${totalSkipped} forbigått (varighet < 5 min eller manglende data).`);
	console.log('');
	console.log('Neste steg: trigg aggregeringen for å fylle weeklyEffort i sensor_aggregates:');
	console.log('  curl -H "Authorization: Bearer $CRON_SECRET" "$ORIGIN/api/cron/aggregate"');

	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
