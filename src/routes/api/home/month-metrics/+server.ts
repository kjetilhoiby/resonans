import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorAggregates, sensorEvents } from '$lib/db/schema';
import { and, eq, gte, like, lt } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Per-dag-metrikker for månedshjulet på hjemskjermen.
 *
 * Returnerer to kart keyet på ISO-dato (YYYY-MM-DD) for én måned:
 *  - `effort`        — daglig treningsbelastning fra sensor_aggregates.metrics.dailyEffort.total
 *  - `egenfrekvens`  — daglig humør/følt-score (0–10), snitt av mood-events (dataType='mood').
 *                      Egenfrekvens-sjekkinn speiles allerede til mood-sensoren.
 *
 * Oppgave-dataene (planlagt/løst) regnes ut klient-side fra sjekklistene og
 * slås sammen med disse i HomeScreen.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;

	const monthParam = url.searchParams.get('month');
	const now = new Date();
	const month = /^\d{4}-\d{2}$/.test(monthParam ?? '')
		? (monthParam as string)
		: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	const [year, mon] = month.split('-').map(Number);
	const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
	const end = new Date(Date.UTC(year, mon, 1, 0, 0, 0)); // eksklusiv start på neste måned

	const [effortRows, moodRows] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(
				eq(sensorAggregates.userId, userId),
				eq(sensorAggregates.period, 'day'),
				like(sensorAggregates.periodKey, `${month}-%`)
			)
		}),
		db
			.select({ data: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'mood'),
					gte(sensorEvents.timestamp, start),
					lt(sensorEvents.timestamp, end)
				)
			)
	]);

	const effort: Record<string, number> = {};
	for (const row of effortRows) {
		const total =
			(row.metrics as { dailyEffort?: { total?: number } } | null)?.dailyEffort?.total ?? 0;
		if (total > 0) effort[row.periodKey] = total;
	}

	// Humør: snitt per dag (morgen/kveld kan begge finnes). Verdiene ligger 0–10.
	const moodAcc: Record<string, { sum: number; n: number }> = {};
	for (const row of moodRows) {
		const d = row.data as { day?: string; rating?: number } | null;
		if (!d?.day || typeof d.rating !== 'number') continue;
		const acc = (moodAcc[d.day] ??= { sum: 0, n: 0 });
		acc.sum += d.rating;
		acc.n += 1;
	}
	const egenfrekvens: Record<string, number> = {};
	for (const [day, { sum, n }] of Object.entries(moodAcc)) {
		if (n > 0) egenfrekvens[day] = sum / n;
	}

	return json({ month, effort, egenfrekvens });
};
