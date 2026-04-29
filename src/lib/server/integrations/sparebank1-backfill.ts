import { registerBatchHandler } from '$lib/server/batch-runner';
import { getSparebank1Sensor, getValidSparebank1AccessToken, syncAllSparebank1Data } from './sparebank1-sync';

registerBatchHandler('sparebank1_backfill', {
	async processDay(userId, date) {
		const sensor = await getSparebank1Sensor(userId);
		if (!sensor) throw new Error('Ingen SpareBank1-sensor funnet');
		await getValidSparebank1AccessToken(sensor);

		const fromDate = new Date(`${date}T00:00:00Z`);
		const toDate = new Date(`${date}T00:00:00Z`);
		toDate.setUTCDate(toDate.getUTCDate() + 1);

		const result = await syncAllSparebank1Data(userId, {
			fromDate,
			toDate,
			skipExistingDedup: false
		});

		return {
			transactionsInserted: result.transactionEvents,
			daysWithTransactions: result.transactionEvents > 0 ? 1 : 0
		};
	},
	mergeStats(acc, day) {
		return {
			transactionsInserted: ((acc.transactionsInserted as number) ?? 0) + ((day.transactionsInserted as number) ?? 0),
			daysWithTransactions: ((acc.daysWithTransactions as number) ?? 0) + ((day.daysWithTransactions as number) ?? 0)
		};
	},
	initialStats() {
		return { transactionsInserted: 0, daysWithTransactions: 0 };
	}
});
