/**
 * Dagens energiforbruk fra Withings.
 *
 * `data.totalCalories` er hvileforbrenning **pluss** aktivitet — altså den andre
 * siden av energibalansen ernæringsloggen måler. `data.calories` alene er bare
 * aktiviteten, og ville gitt et voldsomt underskudd hver eneste dag.
 *
 * Trukket ut av `nutrition-dashboard.ts` slik at chat-verktøyet leser samme tall
 * gjennom samme valg. Duplisert ville dette vært nøyaktig den typen forskjell som
 * ikke oppdages: begge sider ser plausible ut.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { deriveBasalMetabolism } from '$lib/domain/nutrition/expenditure-breakdown';

/** Null når dagen ikke har en aktivitetsrad ennå. */
export async function loadTodayExpenditure(
	userId: string,
	todayKey: string
): Promise<number | null> {
	return (await loadExpenditureContext(userId, todayKey)).totalKcal;
}

/**
 * Dagens forbruk med komponentene, og hvileforbrenningen utledet av nabodagene.
 *
 * Brukeren spurte «hvorfor mener den at jeg har forbrent 2,7k?», og svaret krevde
 * begge Withings-feltene pluss et par ukers historikk. Ett tall alene kan ikke
 * etterprøves — se `$lib/domain/nutrition/expenditure-breakdown`.
 */
export async function loadExpenditureContext(
	userId: string,
	todayKey: string
): Promise<{
	totalKcal: number | null;
	activityKcal: number | null;
	basalKcal: number | null;
	workoutKcal: number | null;
	/** Dagsforbruk per dato, til vektkontrollen. Nyeste først. */
	byDay: Array<{ dateKey: string; totalKcal: number }>;
}> {
	const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
	const [rows, workoutRows] = await Promise.all([
		db.query.sensorEvents.findMany({
			columns: { timestamp: true, data: true },
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'activity'),
				gte(sensorEvents.timestamp, since)
			),
			orderBy: [desc(sensorEvents.timestamp)],
			limit: 30
		}),
		// Withings' egne kalorier per økt. De er den uavhengige kryssjekken mot
		// dagsradens `calories`-felt, som 3. august viste kan være dobbelt så høyt.
		db.query.sensorEvents.findMany({
			columns: { timestamp: true, data: true },
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
			),
			orderBy: [desc(sensorEvents.timestamp)],
			limit: 40
		})
	]);

	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;

	const days = rows.map((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		return {
			dateKey: row.timestamp.toISOString().slice(0, 10),
			totalCalories: num(data.totalCalories),
			activityCalories: num(data.calories)
		};
	});

	// Aktivitetsraden er datert til UTC-midnatt for brukerens lokale dag, så
	// dagsnøkkelen sammenlignes direkte.
	const today = days.find((day) => day.dateKey === todayKey);

	let workoutKcal: number | null = null;
	for (const row of workoutRows) {
		if (row.timestamp.toISOString().slice(0, 10) !== todayKey) continue;
		const value = num((row.data as Record<string, unknown> | null)?.calories);
		if (value === null) continue;
		workoutKcal = (workoutKcal ?? 0) + value;
	}

	return {
		totalKcal: today?.totalCalories ?? null,
		activityKcal: today?.activityCalories ?? null,
		workoutKcal: workoutKcal === null ? null : Math.round(workoutKcal),
		byDay: days.flatMap((day) =>
			day.totalCalories === null ? [] : [{ dateKey: day.dateKey, totalKcal: day.totalCalories }]
		),
		// Dagens egen rad holdes utenfor: er den uenig med seg selv, skal den ikke
		// definere baselinen den måles mot.
		basalKcal: deriveBasalMetabolism(days.filter((day) => day.dateKey !== todayKey))
	};
}
