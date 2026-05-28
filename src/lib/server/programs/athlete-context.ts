/**
 * Athlete-context — bygger en konsolidert "what we know about this athlete"
 * snapshot brukt av program-generatoren og /context-endpointet.
 *
 * Avhenger av at workout-analytics allerede er kjørt for å gi rike PR-er.
 * Hvis ingen analytics finnes (nye brukere / kun Withings-data uten
 * trackPoints), faller vi tilbake til durationSeconds/distanceMeters fra
 * canonicalWorkouts som grovt anslag.
 */

import { db } from '$lib/db';
import { canonicalWorkouts, programTestResults } from '$lib/db/schema';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { estimateVdotFromBestEfforts, paceZonesForVdot, vdotFromCooper, vdotFromTime, type DanielsPaces } from '$lib/server/workouts/vdot';

export type DataQuality = 'rich' | 'thin' | 'none';

export interface AthleteSnapshot {
	dataQuality: DataQuality;
	// Volum siste 4 uker
	recentVolumeKm: number;
	recentSessionsPerWeek: number;
	// Beste prestasjoner (sekunder) — kombinert fra analytics + tester
	bestEfforts: {
		'1k'?: number;
		'3k'?: number;
		'5k'?: number;
		'10k'?: number;
	};
	vdotEstimate?: number;
	vdotSource?: '3k' | '5k' | '10k' | 'cooper';
	paceZones?: DanielsPaces;
	// Siste 5 tester (hvis brukeren har lagt inn explicit tests)
	recentTests: Array<{
		testType: string;
		recordedAt: string;
		result: Record<string, unknown>;
	}>;
	// Styrke-baseline — beste AMRAP/hold pr øvelse de siste 90 dager
	strengthBaseline: Record<string, { reps?: number; durationSeconds?: number; recordedAt: string }>;
	recordedAt: string;
}

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function buildAthleteSnapshot(userId: string): Promise<AthleteSnapshot> {
	const now = new Date();
	const fourWeeksAgo = new Date(now.getTime() - FOUR_WEEKS_MS);
	const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);

	// Recent running workouts for volume aggregation. Vi henter IKKE
	// best_efforts her — det er en cache-kolonne som kanskje ikke eksisterer
	// før schema-sync har kjørt. PR-data hentes fra eksplisitte tester
	// (programTestResults) i stedet, som er en pålitelig kilde.
	type RecentRow = {
		startTime: Date;
		distanceMeters: string | null;
		durationSeconds: string | null;
		sportFamily: string;
	};
	let recentWorkouts: RecentRow[] = [];

	try {
		recentWorkouts = await db
			.select({
				startTime: canonicalWorkouts.startTime,
				distanceMeters: canonicalWorkouts.distanceMeters,
				durationSeconds: canonicalWorkouts.durationSeconds,
				sportFamily: canonicalWorkouts.sportFamily
			})
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					eq(canonicalWorkouts.sportFamily, 'running'),
					gte(canonicalWorkouts.startTime, fourWeeksAgo)
				)
			)
			.orderBy(desc(canonicalWorkouts.startTime));
	} catch (err) {
		console.warn('[athlete-context] canonicalWorkouts query feilet — returnerer tomt snapshot', err);
		return {
			dataQuality: 'none',
			recentVolumeKm: 0,
			recentSessionsPerWeek: 0,
			bestEfforts: {},
			recentTests: [],
			strengthBaseline: {},
			recordedAt: now.toISOString()
		};
	}

	// Eksplisitte tester — også med graceful fallback
	let tests: Array<{
		testType: string;
		recordedAt: Date;
		result: Record<string, any>;
	}> = [];
	try {
		tests = (await db
			.select()
			.from(programTestResults)
			.where(
				and(
					eq(programTestResults.userId, userId),
					gte(programTestResults.recordedAt, ninetyDaysAgo)
				)
			)
			.orderBy(desc(programTestResults.recordedAt))
			.limit(20)) as typeof tests;
	} catch (err) {
		console.warn('[athlete-context] programTestResults query feilet — fortsetter uten tester', err);
		tests = [];
	}

	// Sum recent volume — total meter delt på antall uker = snitt km/uke.
	let recentVolumeMeters = 0;
	for (const w of recentWorkouts) {
		const d = w.distanceMeters ? Number(w.distanceMeters) : 0;
		if (Number.isFinite(d)) recentVolumeMeters += d;
	}
	const recentVolumeKm = Math.round((recentVolumeMeters / 1000 / 4) * 10) / 10;
	const recentSessionsPerWeek = Math.round((recentWorkouts.length / 4) * 10) / 10;

	// Aggreger best efforts fra eksplisitte tester (5k-test, Cooper, 10k tt).
	// Cache-baserte PR-er fra canonical_workouts.bestEfforts kommer i v1.2
	// når schema-sync er bekreftet stabilt.
	const bestEfforts: AthleteSnapshot['bestEfforts'] = {};

	// Tester kan også bidra til best efforts (eksplisitt 5k-test, Cooper → estimert distance)
	for (const t of tests) {
		const r = t.result;
		if (typeof r.time5kSeconds === 'number') {
			if (!bestEfforts['5k'] || r.time5kSeconds < bestEfforts['5k']) {
				bestEfforts['5k'] = r.time5kSeconds;
			}
		}
		if (typeof r.time10kSeconds === 'number') {
			if (!bestEfforts['10k'] || r.time10kSeconds < bestEfforts['10k']) {
				bestEfforts['10k'] = r.time10kSeconds;
			}
		}
	}

	// VDOT
	let vdotEstimate: number | undefined;
	let vdotSource: AthleteSnapshot['vdotSource'];
	const fromEfforts = estimateVdotFromBestEfforts(bestEfforts);
	if (fromEfforts) {
		vdotEstimate = fromEfforts.vdot;
		vdotSource = fromEfforts.sourceDistance;
	} else {
		// Fallback: nyeste Cooper-test
		const cooper = tests.find((t) => t.testType === 'cooper_12min');
		if (cooper && typeof cooper.result.cooper12minMeters === 'number') {
			const v = vdotFromCooper(cooper.result.cooper12minMeters);
			if (v != null) {
				vdotEstimate = v;
				vdotSource = 'cooper';
			}
		}
	}

	const paceZones = vdotEstimate ? paceZonesForVdot(vdotEstimate) : undefined;

	// Styrke-baseline fra tester
	const strengthBaseline: AthleteSnapshot['strengthBaseline'] = {};
	for (const t of tests) {
		const exerciseName = exerciseFromTestType(t.testType);
		if (!exerciseName) continue;
		const existing = strengthBaseline[exerciseName];
		const r = t.result;
		const newReps = typeof r.amrapReps === 'number' ? r.amrapReps : undefined;
		const newHold = typeof r.holdSeconds === 'number' ? r.holdSeconds : undefined;
		const recordedAt = t.recordedAt.toISOString();
		if (!existing) {
			strengthBaseline[exerciseName] = { reps: newReps, durationSeconds: newHold, recordedAt };
		} else {
			// Behold beste (høyeste reps eller hold), bryt ved nyeste hvis like
			const better =
				(newReps != null && (existing.reps ?? 0) < newReps) ||
				(newHold != null && (existing.durationSeconds ?? 0) < newHold);
			if (better) {
				strengthBaseline[exerciseName] = { reps: newReps, durationSeconds: newHold, recordedAt };
			}
		}
	}

	const dataQuality = decideDataQuality({
		sessions: recentWorkouts.length,
		hasBestEfforts: Object.keys(bestEfforts).length > 0,
		hasTests: tests.length > 0
	});

	return {
		dataQuality,
		recentVolumeKm,
		recentSessionsPerWeek,
		bestEfforts,
		vdotEstimate,
		vdotSource,
		paceZones,
		recentTests: tests.slice(0, 5).map((t) => ({
			testType: t.testType,
			recordedAt: t.recordedAt.toISOString(),
			result: t.result as Record<string, unknown>
		})),
		strengthBaseline,
		recordedAt: now.toISOString()
	};
}

function mergeBestEfforts(into: AthleteSnapshot['bestEfforts'], from: Record<string, unknown>) {
	for (const key of ['1k', '3k', '5k', '10k'] as const) {
		const v = from[key];
		if (typeof v !== 'number' || v <= 0) continue;
		const current = into[key];
		if (current == null || v < current) into[key] = v;
	}
}

function decideDataQuality(args: {
	sessions: number;
	hasBestEfforts: boolean;
	hasTests: boolean;
}): DataQuality {
	if (args.sessions === 0 && !args.hasTests) return 'none';
	if (args.sessions < 4 && !args.hasBestEfforts) return 'thin';
	return 'rich';
}

function exerciseFromTestType(testType: string): string | null {
	switch (testType) {
		case 'amrap_utfall':
			return 'Utfall';
		case 'amrap_armhevinger':
			return 'Armhevinger';
		case 'amrap_taahevinger':
			return 'Tåhevinger';
		case 'max_planke':
			return 'Planke';
		default:
			return null;
	}
}

/**
 * Slank versjon for lagring i trainingPrograms.baseline-kolonnen.
 * Beholder bare det som er strengt nødvendig for senere rekalibrering.
 */
export function snapshotForPersistence(snapshot: AthleteSnapshot) {
	return {
		dataQuality: snapshot.dataQuality,
		recentVolumeKm: snapshot.recentVolumeKm,
		recentSessionsPerWeek: snapshot.recentSessionsPerWeek,
		bestEfforts: snapshot.bestEfforts,
		vdotEstimate: snapshot.vdotEstimate,
		paceZones: snapshot.paceZones,
		strengthBaseline: Object.fromEntries(
			Object.entries(snapshot.strengthBaseline).map(([k, v]) => [
				k,
				{ reps: v.reps, durationSeconds: v.durationSeconds }
			])
		),
		recordedAt: snapshot.recordedAt
	};
}
