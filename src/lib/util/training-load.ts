/**
 * Banister-style trening-belastningsmodell.
 *
 * Input: serie med daglig effort (kronologisk, eldst først).
 *  - CTL (Chronic Training Load / "form"): EWMA med 42-dagers tidskonstant.
 *  - ATL (Acute Training Load / "tretthet"): EWMA med 7-dagers tidskonstant.
 *  - TSB (Training Stress Balance): CTL − ATL (positiv = fersk, negativ = sliten).
 *
 * Tidskonstant T gir alpha = 1 − exp(−1/T). Initialverdi 0.
 */

export interface DailyEffort {
	date: string; // 'YYYY-MM-DD'
	effort: number;
}

export interface TrainingLoadPoint {
	date: string;
	effort: number;
	ctl: number;
	atl: number;
	tsb: number;
}

export function computeTrainingLoad(
	series: DailyEffort[],
	{ ctlTimeConstant = 42, atlTimeConstant = 7 }: { ctlTimeConstant?: number; atlTimeConstant?: number } = {}
): TrainingLoadPoint[] {
	const ctlAlpha = 1 - Math.exp(-1 / ctlTimeConstant);
	const atlAlpha = 1 - Math.exp(-1 / atlTimeConstant);

	const filled = fillGaps(series);

	let ctl = 0;
	let atl = 0;
	const out: TrainingLoadPoint[] = [];

	for (const point of filled) {
		ctl = ctl + (point.effort - ctl) * ctlAlpha;
		atl = atl + (point.effort - atl) * atlAlpha;
		out.push({
			date: point.date,
			effort: point.effort,
			ctl: Math.round(ctl * 10) / 10,
			atl: Math.round(atl * 10) / 10,
			tsb: Math.round((ctl - atl) * 10) / 10
		});
	}

	return out;
}

function fillGaps(series: DailyEffort[]): DailyEffort[] {
	if (series.length === 0) return [];
	const out: DailyEffort[] = [];
	const byDate = new Map(series.map((p) => [p.date, p.effort]));
	const first = new Date(series[0].date + 'T00:00:00Z');
	const last = new Date(series[series.length - 1].date + 'T00:00:00Z');
	for (let t = first.getTime(); t <= last.getTime(); t += 86400000) {
		const date = new Date(t).toISOString().split('T')[0];
		out.push({ date, effort: byDate.get(date) ?? 0 });
	}
	return out;
}
