import { matchRunningCycle } from './appliance-profile-service';

export interface ApplianceCycle {
	curve: number[];
	peakWatts: number;
	elapsedMinutes: number;
	totalMinutes: number;
	remainingMinutes: number;
	finishAt: string | null;
	programName: string | null;
	isRunning: boolean;
}

interface ApplianceEventInput {
	data: unknown;
}

interface ProfileInput {
	appliance: string;
	programName: string;
	avgWattBuckets1min: unknown;
	avgDurationMinutes: number | null;
	cycleCount: number | null;
}

export function buildApplianceCycle(
	applianceName: string,
	events: ApplianceEventInput[],
	profiles: ProfileInput[]
): ApplianceCycle | null {
	let curve: number[] | null = null;
	let isRunning = false;
	let programName: string | null = null;
	let estimatedFinishAt: string | null = null;
	let estimatedRemainingMinutes: number | null = null;

	for (const ev of events) {
		const d = (ev.data ?? {}) as Record<string, unknown>;

		if (!curve && Array.isArray(d.watt_buckets_1min_so_far)) {
			curve = (d.watt_buckets_1min_so_far as unknown[]).filter(
				(n): n is number => typeof n === 'number'
			);
			isRunning = true;
			programName = (d.matched_program as string | undefined) ?? null;
		} else if (!curve && Array.isArray(d.watt_buckets_1min)) {
			curve = (d.watt_buckets_1min as unknown[]).filter(
				(n): n is number => typeof n === 'number'
			);
			isRunning = false;
			const label = d.label as { program_name?: string } | undefined;
			programName = label?.program_name ?? (d.matched_program as string | undefined) ?? null;
		}

		if (!estimatedFinishAt && typeof d.estimated_finish_at === 'string') {
			estimatedFinishAt = d.estimated_finish_at;
		}
		if (estimatedRemainingMinutes === null && typeof d.estimated_minutes_remaining === 'number') {
			estimatedRemainingMinutes = d.estimated_minutes_remaining;
		}

		if (curve && estimatedFinishAt && estimatedRemainingMinutes !== null) break;
	}

	if (!curve || curve.length === 0) return null;

	const elapsedMinutes = curve.length;
	const peakWatts = curve.reduce((a, b) => Math.max(a, b), 0);

	let totalMinutes = elapsedMinutes;
	let remainingMinutes = 0;
	let finishAt: string | null = null;

	if (isRunning) {
		if (estimatedFinishAt) {
			finishAt = estimatedFinishAt;
			const ms = new Date(estimatedFinishAt).getTime() - Date.now();
			remainingMinutes = Math.max(0, Math.round(ms / 60_000));
		} else if (estimatedRemainingMinutes !== null) {
			remainingMinutes = Math.max(0, Math.round(estimatedRemainingMinutes));
			finishAt = new Date(Date.now() + remainingMinutes * 60_000).toISOString();
		} else {
			const matchProfiles = profiles
				.filter((p) => p.appliance === applianceName)
				.map((p) => ({
					programName: p.programName,
					avgWattBuckets1min: Array.isArray(p.avgWattBuckets1min)
						? (p.avgWattBuckets1min as number[])
						: [],
					avgDurationMinutes: p.avgDurationMinutes ?? 0,
					cycleCount: p.cycleCount ?? 0
				}));
			const match = matchRunningCycle(curve, matchProfiles, elapsedMinutes);
			if (match) {
				programName = programName ?? match.programName;
				remainingMinutes = match.estimatedRemainingMinutes;
				finishAt = new Date(Date.now() + remainingMinutes * 60_000).toISOString();
				totalMinutes = Math.max(elapsedMinutes, Math.round(match.estimatedDurationMinutes));
			}
		}
		totalMinutes = Math.max(totalMinutes, elapsedMinutes + remainingMinutes);
	}

	return {
		curve,
		peakWatts,
		elapsedMinutes,
		totalMinutes,
		remainingMinutes,
		finishAt,
		programName,
		isRunning
	};
}
