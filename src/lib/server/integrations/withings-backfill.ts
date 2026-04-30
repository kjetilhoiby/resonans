import { registerBatchHandler } from '$lib/server/batch-runner';
import {
	getWithingsSensor,
	getValidAccessToken,
	syncAllWithingsData,
	prefetchWithingsEventsForRange,
	writeWithingsDayFromPrefetch,
	type WithingsPrefetchedDay
} from './withings-sync';

registerBatchHandler('withings_backfill', {
	async prefetch(userId, fromDate, toDate) {
		return await prefetchWithingsEventsForRange(userId, fromDate, toDate) as Record<string, unknown>;
	},

	async processDay(userId, date, prefetchedData) {
		if (prefetchedData) {
			const { sensorId, byDay } = prefetchedData as {
				sensorId: string;
				byDay: Record<string, WithingsPrefetchedDay>;
			};
			const dayData = byDay[date] ?? { weight: [], activity: [], sleep: [], workouts: [] };
			return await writeWithingsDayFromPrefetch(userId, sensorId, dayData);
		}

		// Fallback: live fetch (no prefetch in payload)
		const sensor = await getWithingsSensor(userId);
		if (!sensor) throw new Error('Ingen Withings-sensor funnet');
		await getValidAccessToken(sensor);

		const from = new Date(`${date}T00:00:00Z`);
		const to = new Date(`${date}T00:00:00Z`);
		to.setUTCDate(to.getUTCDate() + 1);

		const result = await syncAllWithingsData(userId, false, from, to);
		return {
			weight: result.weight,
			activity: result.activity,
			sleep: result.sleep,
			workouts: result.workouts,
			total: result.weight + result.activity + result.sleep + result.workouts
		};
	},

	mergeStats(acc, day) {
		return {
			weight: ((acc.weight as number) ?? 0) + ((day.weight as number) ?? 0),
			activity: ((acc.activity as number) ?? 0) + ((day.activity as number) ?? 0),
			sleep: ((acc.sleep as number) ?? 0) + ((day.sleep as number) ?? 0),
			workouts: ((acc.workouts as number) ?? 0) + ((day.workouts as number) ?? 0),
			total: ((acc.total as number) ?? 0) + ((day.total as number) ?? 0)
		};
	},

	initialStats() {
		return { weight: 0, activity: 0, sleep: 0, workouts: 0, total: 0 };
	}
});
