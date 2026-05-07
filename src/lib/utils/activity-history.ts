interface ActivityLike {
	activityId?: string;
	startTime: string;
	sportType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
}

export interface PaceBaseline {
	avgPaceSecondsPerKm: number;
	sampleCount: number;
	weeksBack: number;
}

export interface PaceComparison {
	deltaSecondsPerKm: number;
	pct: number;
	isFaster: boolean;
}

export function buildPaceBaseline(
	activities: ActivityLike[],
	sportType: string,
	excludeActivityId: string | null = null,
	weeksBack = 12
): PaceBaseline | null {
	const cutoff = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000;
	const lowered = sportType.toLowerCase();
	const eligible = activities.filter((a) => {
		if (excludeActivityId && a.activityId === excludeActivityId) return false;
		if (a.sportType.toLowerCase() !== lowered) return false;
		if (a.paceSecondsPerKm == null || a.paceSecondsPerKm <= 0) return false;
		const t = new Date(a.startTime).getTime();
		return Number.isFinite(t) && t >= cutoff;
	});
	if (eligible.length < 5) return null;

	const totalDistanceM = eligible.reduce(
		(sum, a) => sum + (a.distanceMeters ?? 0),
		0
	);
	const totalSec = eligible.reduce(
		(sum, a) => sum + (a.durationSeconds ?? 0),
		0
	);
	if (totalDistanceM <= 0 || totalSec <= 0) return null;

	return {
		avgPaceSecondsPerKm: totalSec / (totalDistanceM / 1000),
		sampleCount: eligible.length,
		weeksBack
	};
}

export function compareActivityToBaseline(
	paceSecondsPerKm: number | null | undefined,
	baseline: PaceBaseline
): PaceComparison | null {
	if (paceSecondsPerKm == null || paceSecondsPerKm <= 0) return null;
	const delta = paceSecondsPerKm - baseline.avgPaceSecondsPerKm;
	return {
		deltaSecondsPerKm: delta,
		pct: (delta / baseline.avgPaceSecondsPerKm) * 100,
		isFaster: delta < 0
	};
}

export function formatPaceDelta(deltaSec: number): string {
	const abs = Math.abs(Math.round(deltaSec));
	const m = Math.floor(abs / 60);
	const s = abs % 60;
	const sign = deltaSec < 0 ? '−' : '+';
	if (m > 0) return `${sign}${m}:${String(s).padStart(2, '0')}`;
	return `${sign}${s}s`;
}
