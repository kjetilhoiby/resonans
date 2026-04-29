import { registerBatchHandler } from '$lib/server/batch-runner';
import { backfillSleepHrForDate, getWithingsSensor, getValidAccessToken } from './withings-sync';

registerBatchHandler('withings_sleep_hr', {
	async processDay(userId, date) {
		const sensor = await getWithingsSensor(userId);
		if (!sensor) throw new Error('Ingen Withings-sensor funnet');
		const token = await getValidAccessToken(sensor);
		return await backfillSleepHrForDate(userId, token, date);
	},
	mergeStats(acc, day) {
		return {
			found: ((acc.found as number) ?? 0) + ((day.found as number) ?? 0),
			updated: ((acc.updated as number) ?? 0) + ((day.updated as number) ?? 0),
			daysWithHr: ((acc.daysWithHr as number) ?? 0) + (day.hrAverage != null ? 1 : 0)
		};
	},
	initialStats() {
		return { found: 0, updated: 0, daysWithHr: 0 };
	}
});
