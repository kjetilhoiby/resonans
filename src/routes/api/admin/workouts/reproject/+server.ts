import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import {
	compareWeeklyEffort,
	DEFAULT_REPROJECT_WEEKS,
	resolveReprojectWindow,
	type WeekEffortRow
} from '$lib/domain/health/reproject-window';

export const config = { maxDuration: 60 };

/**
 * Reberegner lagrede `effortScore` fra gjeldende skåringsmodell.
 *
 * `POST /api/admin/workouts/reproject?weeks=8[&dryRun=true]`
 *
 * ## Hvorfor endepunktet finnes
 *
 * `effortScore` er lagret, ikke regnet ved lesing. Endrer man modellen — makspuls,
 * `MET_CALIBRATION`, en familiefaktor — gjelder den bare økter som skrives etterpå,
 * og historikken står på gammel skala. Effort-båndet ankres på snittet av de siste
 * fire ukene fra nettopp de lagrede radene, så resultatet er at ankeret og denne ukas
 * økter måles i ulike enheter. Uka ser kunstig lav ut mot et for høyt bånd, og
 * ingenting sier fra: begge tallene ser plausible ut.
 *
 * Jobbtypen `workout_projection_refresh` gjorde alt dette fra før, men ingenting kunne
 * starte den med et vilkårlig datospenn — `refreshForRange` var bare nåbar fra
 * enkeltøkt-ruter og fra en staleness-sweeper med et spenn utledet av mål-datoer.
 *
 * ## Hva den gjør
 *
 * `refreshForRange` henter øktene på nytt, skårer dem med `getEffortBaseline` og
 * skriver `canonical_workouts` + `workout_daily_aggregates` om. Den er **idempotent**:
 * samme modell inn gir samme tall ut, så den kan kjøres om igjen.
 *
 * `dryRun=true` skårer og sammenligner uten å skrive, slik at man ser hva endringen
 * ville gjort før den gjøres — samme mønster som
 * `POST /api/sensors/withings/enrich-weight`.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const userId = url.searchParams.get('userId')?.trim() || locals.userId;
	const dryRun = url.searchParams.get('dryRun') === 'true';

	const resolved = resolveReprojectWindow(url.searchParams.get('weeks') ?? undefined, new Date());
	if ('error' in resolved) {
		return json({ success: false, error: resolved.error }, { status: 400 });
	}
	const { weeks, fromDate, toDate } = resolved.window;

	const before = await readWeeklyEffort(userId, fromDate, toDate);
	// Baselinen rapporteres fordi den ER endringen: `maxHrSource: 'age'` mot
	// `'observed'` forklarer hvorfor tallene flyttet seg, og en manglende
	// kroppsprofil er den stille grunnen til at ingenting skjedde.
	const baseline = await getEffortBaseline(userId);

	const window = {
		weeks,
		fromIso: fromDate.toISOString(),
		toIso: toDate.toISOString()
	};
	const baselineSummary = {
		restHr: baseline.restHr,
		maxHr: baseline.maxHr,
		restHrSource: baseline.restHrSource ?? null,
		maxHrSource: baseline.maxHrSource ?? null,
		derived: baseline.derived
	};

	if (dryRun) {
		return json({
			success: true,
			dryRun: true,
			window,
			baseline: baselineSummary,
			weeklyEffortBefore: before,
			workoutsInRange: before.reduce((sum, r) => sum + r.workouts, 0),
			message:
				'Ingenting er skrevet. Kjør uten dryRun for å reberegne — og les baseline.maxHrSource: står den på «observed» mens du forventet «age», mangler fødselsåret i kroppsprofilen.'
		});
	}

	const result = await WorkoutProjectionService.refreshForRange(userId, fromDate, toDate);
	const after = await readWeeklyEffort(userId, fromDate, toDate);
	const comparison = compareWeeklyEffort(before, after);

	const totalBefore = before.reduce((sum, r) => sum + r.effort, 0);
	const totalAfter = after.reduce((sum, r) => sum + r.effort, 0);

	console.log(
		`[reproject] ${userId}: ${weeks} uker, ${result.canonicalCount} økter, effort ${totalBefore.toFixed(0)} → ${totalAfter.toFixed(0)}, maxHr ${baseline.maxHr} (${baseline.maxHrSource})`
	);

	return json({
		success: true,
		window,
		baseline: baselineSummary,
		canonicalCount: result.canonicalCount,
		dailyCount: result.dailyCount,
		totalEffortBefore: Math.round(totalBefore),
		totalEffortAfter: Math.round(totalAfter),
		weeks: comparison
	});
};

/**
 * Effort per uke fra de lagrede radene.
 *
 * Uke-nøkkelen er `date_trunc('week')`, som er mandag i Postgres — samme
 * ukekonvensjon som `mondayOfDate` i `tracks/curve.ts`, slik at radene her lar seg
 * legge ved siden av båndet uten å være forskjøvet en dag.
 */
async function readWeeklyEffort(userId: string, from: Date, to: Date): Promise<WeekEffortRow[]> {
	const rows = await db
		.select({
			weekStart: sql<string>`to_char(date_trunc('week', ${canonicalWorkouts.startTime}), 'YYYY-MM-DD')`,
			effort: sql<string>`coalesce(sum(${canonicalWorkouts.effortScore}), 0)`,
			workouts: sql<number>`count(*)::int`
		})
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, from),
				lte(canonicalWorkouts.startTime, to)
			)
		)
		.groupBy(sql`date_trunc('week', ${canonicalWorkouts.startTime})`)
		.orderBy(sql`date_trunc('week', ${canonicalWorkouts.startTime})`);

	return rows.map((row) => ({
		weekStart: row.weekStart,
		effort: Number(row.effort),
		workouts: Number(row.workouts)
	}));
}

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);
	return json({
		success: true,
		usage: `POST /api/admin/workouts/reproject?weeks=${DEFAULT_REPROJECT_WEEKS}[&dryRun=true]`,
		hint: 'GET gjør ingenting — reberegning skriver, og skriving hører på POST.',
		requested: url.searchParams.get('weeks') ?? null
	});
};
