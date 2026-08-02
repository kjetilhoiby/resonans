/**
 * Daglig effort-serie ut av `sensor_aggregates` (period = 'day').
 *
 * Serien mater form- og belastningskortene (CTL/ATL/TSB). Den bodde på
 * helse-mortemaet fram til august 2026, men treningsbelastning er trening —
 * mortemaet viser sammenhengen via signalene i stedet.
 */

export interface DailyAggregateRow {
	periodKey: string;
	metrics: unknown;
}

export interface DailyEffortPoint {
	date: string;
	effort: number;
}

/**
 * Radene kommer nyeste først (spørringen sorterer `desc`), men
 * `computeTrainingLoad` regner eksponentielt snitt framover og krever
 * eldste først. Snuingen skjer her, ikke hos kallstedet.
 *
 * Dager uten registrert effort blir 0 og ikke droppet: en hviledag er et
 * datapunkt i belastningsmodellen, ikke et hull.
 */
export function mapDailyEffortSeries(rows: DailyAggregateRow[]): DailyEffortPoint[] {
	return rows
		.slice()
		.reverse()
		.map((row) => ({
			date: row.periodKey,
			effort: (row.metrics as { dailyEffort?: { total?: number } } | null)?.dailyEffort?.total ?? 0
		}));
}
