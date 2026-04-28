/**
 * GET /api/sensor-summary
 *
 * Returnerer prosesserte sensor-verdier for dashboard og HomeScreen-widgets.
 * Bruker pre-aggregerte ukentlige data (sensorAggregates) + siste råevents for nåverdi.
 *
 * Response:
 * {
 *   weight: { current, unit, delta, sparkline }  // nåverdi i kg, endring vs uke siden
 *   sleep:  { current, unit, sparkline }          // i timer
 *   steps:  { current, unit, sparkline }          // daglig snitt i uken
 *   running: { weekKm, unit, sparkline }          // km løpt denne uken
 * }
 */
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorAggregates, sensorEvents, users } from '$lib/db/schema';
import { and, eq, desc, gte, inArray, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

async function measureStep<T>(label: string, userId: string, op: () => Promise<T>): Promise<T> {
	const t0 = performance.now();
	try {
		const result = await op();
		const count = Array.isArray(result) ? result.length : result ? 1 : 0;
		console.log(`[perf][sensor-summary] user=${userId} step=${label} ms=${(performance.now() - t0).toFixed(0)} count=${count}`);
		return result;
	} catch (error) {
		console.error(`[perf][sensor-summary] user=${userId} step=${label} failed ms=${(performance.now() - t0).toFixed(0)}`);
		throw error;
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	const tTotal = performance.now();
	const userId = locals.userId;
	const user = await measureStep('user_lookup', userId, () =>
		db.query.users.findFirst({ where: eq(users.id, userId) })
	);
	const partnerUserId = user?.partnerUserId || null;

	const sevenWeeksAgo = new Date();
	sevenWeeksAgo.setDate(sevenWeeksAgo.getDate() - 49);

	const sevenMonthsAgo = new Date();
	sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
	sevenMonthsAgo.setDate(1);
	sevenMonthsAgo.setHours(0, 0, 0, 0);

	const relationshipSince = new Date();
	relationshipSince.setDate(relationshipSince.getDate() - 30);

	// Alle tre queries parallelt
	const [weeklyAggs, runEvents, txRows, relationshipRows] = await Promise.all([
		measureStep('weekly_aggregates', userId, () =>
			db
				.select({ periodKey: sensorAggregates.periodKey, metrics: sensorAggregates.metrics })
				.from(sensorAggregates)
				.where(and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'week')))
				.orderBy(desc(sensorAggregates.periodKey))
				.limit(8)
		),
		measureStep('running_events', userId, () =>
			db
				.select({
					timestamp: sensorEvents.timestamp,
					distance: sql<number>`(data->>'distance')::numeric`
				})
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'workout'),
						sql`data->>'sportType' IN ('running', 'indoor_running')`,
						sql`(data->>'distance')::numeric > 0`,
						gte(sensorEvents.timestamp, sevenWeeksAgo)
					)
				)
				.orderBy(desc(sensorEvents.timestamp))
		),
		measureStep('transaction_events', userId, () =>
			db
				.select({
					timestamp: sensorEvents.timestamp,
					amount: sql<number>`(data->>'amount')::numeric`
				})
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'bank_transaction'),
						gte(sensorEvents.timestamp, sevenMonthsAgo),
						sql`(data->>'amount')::numeric < 0`
					)
				)
		),
		partnerUserId
			? measureStep('relationship_events', userId, () =>
				db
					.select({
						userId: sensorEvents.userId,
						timestamp: sensorEvents.timestamp,
						day: sql<string>`${sensorEvents.data}->>'day'`,
						score: sql<number>`(data->>'score')::int`
					})
					.from(sensorEvents)
					.where(
						and(
							eq(sensorEvents.dataType, 'relationship_checkin'),
							inArray(sensorEvents.userId, [userId, partnerUserId]),
							gte(sensorEvents.timestamp, relationshipSince)
						)
					)
					.orderBy(desc(sensorEvents.timestamp))
			)
			: Promise.resolve([]),
	]);

	// Kronologisk rekkefølge (eldst → nyest)
	const weeks = weeklyAggs.reverse();

	// ── Vekt ──
	const weightSeries = weeks
		.map((w) => w.metrics?.weight?.avg ?? null)
		.filter((v): v is number => v !== null);
	const currentWeight = weightSeries.at(-1) ?? null;
	const prevWeight = weightSeries.at(-2) ?? null;
	const weightDelta =
		currentWeight !== null && prevWeight !== null
			? Math.round((currentWeight - prevWeight) * 10) / 10
			: 0;

	// ── Søvn ──
	// sensorAggregates.metrics.sleep.avg antas å være i timer
	// Hvis verdien > 15 er den lagret i minutter → konverter
	const rawSleepSeries = weeks
		.map((w) => w.metrics?.sleep?.avg ?? null)
		.filter((v): v is number => v !== null);
	const sleepNeedsConversion = rawSleepSeries.some((v) => v > 15);
	const sleepSeries = sleepNeedsConversion
		? rawSleepSeries.map((v) => Math.round((v / 60) * 10) / 10)
		: rawSleepSeries.map((v) => Math.round(v * 10) / 10);
	const currentSleep = sleepSeries.at(-1) ?? null;

	// ── Skritt ──
	const stepsSeries = weeks
		.map((w) => w.metrics?.steps?.avg ?? null)
		.filter((v): v is number => v !== null)
		.map((v) => Math.round(v));
	const currentSteps = stepsSeries.at(-1) ?? null;

	// ── Løping: grupper fra forhåndshentede råevents ──
	// Withings returnerer distanse i meter → konverter til km
	type WeekBucket = Map<string, number>;
	const runByWeek: WeekBucket = new Map();
	for (const evt of runEvents) {
		const isoWeek = getISOWeekKey(evt.timestamp);
		const distKm = Number(evt.distance) / 1000;
		runByWeek.set(isoWeek, (runByWeek.get(isoWeek) ?? 0) + distKm);
	}

	// Bygg sparkline basert på de 7 siste ukene
	const runSparkline: number[] = weeks.map((w) => {
		const km = runByWeek.get(w.periodKey) ?? 0;
		return Math.round(km * 10) / 10;
	});
	const weekKm = runSparkline.at(-1) ?? 0;

	// ── Økonomi: grupper fra forhåndshentede bank_transactions ──
	// Grupper per måned (YYYY-MM) og summer absolutt forbruk
	const spendByMonth = new Map<string, number>();
	for (const row of txRows) {
		const month = row.timestamp.toISOString().slice(0, 7);
		const abs = Math.abs(Number(row.amount));
		spendByMonth.set(month, (spendByMonth.get(month) ?? 0) + abs);
	}

	// Bygg sparkline for de siste 6 månedene + inneværende
	const spendSparkline: number[] = [];
	const spendMonthKeys: string[] = [];
	for (let i = 6; i >= 0; i--) {
		const d = new Date();
		d.setMonth(d.getMonth() - i);
		spendMonthKeys.push(d.toISOString().slice(0, 7));
	}
	for (const key of spendMonthKeys) {
		spendSparkline.push(Math.round(spendByMonth.get(key) ?? 0));
	}
	const currentMonthSpend = spendSparkline.at(-1) ?? 0;
	const prevMonthSpend = spendSparkline.at(-2) ?? null;
	const spendDelta =
		prevMonthSpend !== null && prevMonthSpend > 0
			? Math.round(currentMonthSpend - prevMonthSpend)
			: 0;

	const relationshipByDay = new Map<string, { mine?: number; partner?: number }>();
	for (const row of relationshipRows) {
		if (!row.day || !Number.isFinite(row.score)) continue;
		const bucket = relationshipByDay.get(row.day) || {};
		if (row.userId === userId) bucket.mine = row.score;
		else bucket.partner = row.score;
		relationshipByDay.set(row.day, bucket);
	}

	const dayKeysAsc = Array.from(relationshipByDay.keys()).sort();
	const pairAverages = dayKeysAsc
		.map((key) => {
			const day = relationshipByDay.get(key);
			if (!day || typeof day.mine !== 'number' || typeof day.partner !== 'number') return null;
			return (day.mine + day.partner) / 2;
		})
		.filter((value): value is number => value !== null);

	const latestDay = dayKeysAsc.at(-1);
	const latest = latestDay ? relationshipByDay.get(latestDay) : null;
	const latestMine = latest && typeof latest.mine === 'number' ? latest.mine : null;
	const latestPartner = latest && typeof latest.partner === 'number' ? latest.partner : null;
	const revealToday = latestMine !== null && latestPartner !== null;

	const priorAverage = pairAverages.length > 1 ? pairAverages[pairAverages.length - 2] : null;
	const currentAverage = pairAverages.length > 0 ? pairAverages[pairAverages.length - 1] : null;
	const relationshipDelta =
		currentAverage !== null && priorAverage !== null
			? Math.round((currentAverage - priorAverage) * 10) / 10
			: 0;

	const recentTwoWeeks = dayKeysAsc.slice(-14);
	let mismatchDays14 = 0;
	let bothNegativeDays14 = 0;
	for (const key of recentTwoWeeks) {
		const day = relationshipByDay.get(key);
		if (!day || typeof day.mine !== 'number' || typeof day.partner !== 'number') continue;
		if (Math.abs(day.mine - day.partner) >= 2) mismatchDays14++;
		if (day.mine <= 3 && day.partner <= 3) bothNegativeDays14++;
	}

	console.log(`[perf][sensor-summary] user=${userId} step=total ms=${(performance.now() - tTotal).toFixed(0)}`);

	return json({
		weight: {
			current: currentWeight !== null ? Math.round(currentWeight * 10) / 10 : null,
			unit: 'kg',
			delta: weightDelta,
			sparkline: weightSeries.slice(-7).map((v) => Math.round(v * 10) / 10)
		},
		sleep: {
			current: currentSleep,
			unit: 'h',
			sparkline: sleepSeries.slice(-7)
		},
		steps: {
			current: currentSteps,
			unit: 'skritt',
			sparkline: stepsSeries.slice(-7)
		},
		running: {
			weekKm,
			unit: 'km',
			sparkline: runSparkline.slice(-7)
		},
		spending: {
			current: currentMonthSpend,
			unit: 'kr',
			delta: spendDelta,
			sparkline: spendSparkline
		},
		relationship: {
			current: latestMine,
			unit: '/7',
			delta: relationshipDelta,
			sparkline: pairAverages.slice(-7).map((value) => Math.round(value * 10) / 10),
			revealed: revealToday,
			partnerSubmitted: latestPartner !== null,
			mismatchDays14,
			bothNegativeDays14,
			followUpRecommended: mismatchDays14 > 0 || bothNegativeDays14 > 0
		}
	});
};

/** Returnerer 'YYYY-Www' for en Date-instans */
function getISOWeekKey(date: Date): string {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, '0')}`;
}
