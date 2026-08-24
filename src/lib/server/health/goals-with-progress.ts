/**
 * Målene i helse-familien, med progresjonstallene fra `sensor_goals`.
 *
 * Lå privat i `workouts/workout-assessment.ts` fram til august 2026. Da
 * helse-briefingen trengte de samme radene, var valget mellom en andre spørring
 * og en delt leser — og CLAUDE.md er utvetydig: to veier inn til de samme
 * tallene driver fra hverandre. Verre her enn de fleste steder, siden begge
 * leserne SIER tallene til brukeren: øktsiden og helsechatten skal ikke oppgi
 * ulik avstand til samme mål.
 *
 * `sensor_goals` er den viktige halvdelen. Uten den leses måltitler alene, og
 * det ga «redusere vekten til 85 kg og 95 kg» — to tall fra en tittel, uten
 * kontekst om hva som faktisk er målt.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, sensorGoals } from '$lib/db/schema';
import type { GoalInput } from '$lib/domain/health/goal-horizon';

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

export async function readGoalsWithProgress(
	userId: string,
	themeIds: string[]
): Promise<GoalInput[]> {
	if (themeIds.length === 0) return [];

	const rows = await db.query.goals.findMany({
		where: and(
			eq(goals.userId, userId),
			inArray(goals.themeId, themeIds),
			inArray(goals.status, ['active', 'paused'])
		),
		columns: { id: true, title: true, description: true, targetDate: true, periodKey: true, status: true }
	});
	if (rows.length === 0) return [];

	const sensorRows = await db.query.sensorGoals.findMany({
		where: inArray(
			sensorGoals.goalId,
			rows.map((r) => r.id)
		),
		columns: {
			goalId: true,
			metricType: true,
			targetValue: true,
			currentValue: true,
			baselineValue: true,
			unit: true
		}
	});
	const byGoal = new Map(sensorRows.map((s) => [s.goalId, s]));

	return rows.map((row) => {
		const sensor = byGoal.get(row.id);
		return {
			title: row.title,
			description: row.description,
			targetDate: row.targetDate ?? null,
			periodKey: row.periodKey ?? null,
			status: row.status,
			sensor: sensor
				? {
						metricType: sensor.metricType ?? null,
						targetValue: toNumber(sensor.targetValue),
						currentValue: toNumber(sensor.currentValue),
						baselineValue: toNumber(sensor.baselineValue),
						unit: sensor.unit ?? null
					}
				: null
		};
	});
}
