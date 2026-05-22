import { db } from '$lib/db';
import { applianceProfiles, sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

const MIN_MINUTES = 5;
const MIN_CYCLES = 3;
const MAX_MAE = 0.15;

export interface MatchResult {
	programName: string;
	confidence: number;
	estimatedDurationMinutes: number;
	estimatedRemainingMinutes: number;
}

function normalize(values: number[]): number[] | null {
	const peak = Math.max(...values);
	if (peak === 0) return null;
	return values.map((v) => v / peak);
}

export function matchRunningCycle(
	wattBuckets1min: number[],
	profiles: { programName: string; avgWattBuckets1min: number[]; avgDurationMinutes: number; cycleCount: number }[],
	elapsedMinutes: number
): MatchResult | null {
	if (wattBuckets1min.length < MIN_MINUTES) return null;

	const runningNorm = normalize(wattBuckets1min);
	if (!runningNorm) return null;

	let best: MatchResult | null = null;
	let bestMae = MAX_MAE;

	for (const profile of profiles) {
		if (profile.cycleCount < MIN_CYCLES) continue;

		const profileBuckets = profile.avgWattBuckets1min;
		const n = Math.min(runningNorm.length, profileBuckets.length);
		if (n < MIN_MINUTES) continue;

		const profileSlice = profileBuckets.slice(0, n);
		const profileNorm = normalize(profileSlice);
		if (!profileNorm) continue;

		let sum = 0;
		for (let i = 0; i < n; i++) {
			sum += Math.abs(runningNorm[i] - profileNorm[i]);
		}
		const mae = sum / n;

		if (mae < bestMae) {
			bestMae = mae;
			const confidence = Math.round((1.0 - mae / MAX_MAE) * 100) / 100;
			const remaining = Math.max(0, Math.round(profile.avgDurationMinutes - elapsedMinutes));
			best = {
				programName: profile.programName,
				confidence,
				estimatedDurationMinutes: profile.avgDurationMinutes,
				estimatedRemainingMinutes: remaining
			};
		}
	}

	return best;
}

export async function getProfiles(userId: string, appliance: string) {
	return db
		.select()
		.from(applianceProfiles)
		.where(and(eq(applianceProfiles.userId, userId), eq(applianceProfiles.appliance, appliance)));
}

export async function rebuildProfile(userId: string, appliance: string, programName: string) {
	const events = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'appliance_cycle_summary')
			)
		);

	type CycleData = {
		appliance?: string;
		label?: { program_name?: string };
		duration_minutes?: number;
		total_kwh?: number;
		watt_buckets_1min?: number[];
	};

	const labeled = events.filter((e) => {
		const d = e.data as CycleData;
		return d?.appliance === appliance && d?.label?.program_name === programName;
	});

	if (labeled.length === 0) {
		await db
			.delete(applianceProfiles)
			.where(
				and(
					eq(applianceProfiles.userId, userId),
					eq(applianceProfiles.appliance, appliance),
					eq(applianceProfiles.programName, programName)
				)
			);
		return;
	}

	const durations: number[] = [];
	const kwhs: number[] = [];
	const allBuckets: number[][] = [];

	for (const e of labeled) {
		const d = e.data as CycleData;
		if (d.duration_minutes != null) durations.push(d.duration_minutes);
		if (d.total_kwh != null) kwhs.push(d.total_kwh);
		if (d.watt_buckets_1min?.length) allBuckets.push(d.watt_buckets_1min);
	}

	const maxLen = Math.max(...allBuckets.map((b) => b.length));
	const avgBuckets: number[] = [];
	for (let i = 0; i < maxLen; i++) {
		const vals = allBuckets.filter((b) => i < b.length).map((b) => b[i]);
		avgBuckets.push(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10);
	}

	const peak = allBuckets.length > 0 ? Math.max(...allBuckets.map((b) => Math.max(...b))) : 0;
	const avgDuration = durations.length > 0 ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : 0;
	const avgKwh = kwhs.length > 0 ? Math.round((kwhs.reduce((a, b) => a + b, 0) / kwhs.length) * 1000) / 1000 : 0;

	await db
		.insert(applianceProfiles)
		.values({
			userId,
			appliance,
			programName,
			avgWattBuckets1min: avgBuckets,
			avgDurationMinutes: avgDuration,
			avgKwh,
			peakWatts: Math.round(peak * 10) / 10,
			cycleCount: labeled.length,
			updatedAt: new Date()
		})
		.onConflictDoUpdate({
			target: [applianceProfiles.userId, applianceProfiles.appliance, applianceProfiles.programName],
			set: {
				avgWattBuckets1min: avgBuckets,
				avgDurationMinutes: avgDuration,
				avgKwh,
				peakWatts: Math.round(peak * 10) / 10,
				cycleCount: labeled.length,
				updatedAt: new Date()
			}
		});
}
