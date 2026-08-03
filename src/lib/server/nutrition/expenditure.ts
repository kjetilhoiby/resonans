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

/** Null når dagen ikke har en aktivitetsrad ennå. */
export async function loadTodayExpenditure(
	userId: string,
	todayKey: string
): Promise<number | null> {
	const rows = await db.query.sensorEvents.findMany({
		columns: { timestamp: true, data: true },
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'activity'),
			gte(sensorEvents.timestamp, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
		),
		orderBy: [desc(sensorEvents.timestamp)],
		limit: 5
	});

	// Aktivitetsraden er datert til UTC-midnatt for brukerens lokale dag, så
	// dagsnøkkelen sammenlignes direkte.
	const today = rows.find((row) => row.timestamp.toISOString().slice(0, 10) === todayKey);
	const value = (today?.data as { totalCalories?: unknown } | null)?.totalCalories;
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
