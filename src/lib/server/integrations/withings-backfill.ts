import { registerBatchHandler } from '$lib/server/batch-runner';
import { getWithingsSensor, getValidAccessToken, syncAllWithingsData } from './withings-sync';

registerBatchHandler('withings_backfill', {
	async processDay(userId, date) {
		const sensor = await getWithingsSensor(userId);
		if (!sensor) throw new Error('Ingen Withings-sensor funnet');
		await getValidAccessToken(sensor);

		const fromDate = new Date(`${date}T00:00:00Z`);
		const toDate = new Date(`${date}T00:00:00Z`);
		toDate.setUTCDate(toDate.getUTCDate() + 1);

		const result = await syncAllWithingsData(userId, false, fromDate, toDate);

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
