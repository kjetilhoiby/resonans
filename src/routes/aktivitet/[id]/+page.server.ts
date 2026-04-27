import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensorEvents, goals, themes } from '$lib/db/schema';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { getWorkoutContextForUser, buildWorkoutChatPrompt } from '$lib/server/workout-context';
import type { WorkoutSplitForContext, CrossSourceHr } from '$lib/server/workout-context';

// --- Splits calculation (server-side, from track points) ---

interface TrackPt { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null; }

function haversine(a: TrackPt, b: TrackPt): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
	return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function computeSplits(pts: TrackPt[]): WorkoutSplitForContext[] {
	if (pts.length < 2) return [];

	const cumDist: number[] = [0];
	const times: (number | null)[] = [pts[0].time ? new Date(pts[0].time).getTime() : null];
	for (let i = 1; i < pts.length; i++) {
		cumDist.push(cumDist[i - 1] + haversine(pts[i - 1], pts[i]));
		times.push(pts[i].time ? new Date(pts[i].time).getTime() : null);
	}
	const totalKm = Math.floor(cumDist[cumDist.length - 1] / 1000);
	const splits: WorkoutSplitForContext[] = [];

	function interpTime(targetM: number): number | null {
		let lo = 0;
		for (let i = 1; i < cumDist.length; i++) {
			if (cumDist[i] >= targetM) { lo = i - 1; break; }
		}
		const t0 = times[lo], t1 = times[lo + 1] ?? null;
		if (t0 == null || t1 == null) return null;
		const frac = (targetM - cumDist[lo]) / (cumDist[lo + 1] - cumDist[lo] || 1);
		return t0 + frac * (t1 - t0);
	}

	for (let km = 1; km <= totalKm; km++) {
		const prevM = (km - 1) * 1000;
		const targetM = km * 1000;

		let startIdx = 0, endIdx = cumDist.length - 1;
		for (let i = 0; i < cumDist.length; i++) {
			if (cumDist[i] <= prevM) startIdx = i;
			if (cumDist[i] <= targetM) endIdx = i;
		}

		const tStart = interpTime(prevM);
		const tEnd = interpTime(targetM);
		const paceSecPerKm = tStart != null && tEnd != null && tEnd > tStart ? (tEnd - tStart) / 1000 : null;

		const segHrs = pts.slice(startIdx, endIdx + 1).map((p) => p.hr).filter((h): h is number => h != null);
		const avgHr = segHrs.length > 0 ? Math.round(segHrs.reduce((s, h) => s + h, 0) / segHrs.length) : null;

		let eleGain = 0, eleLoss = 0;
		for (let i = startIdx + 1; i <= endIdx; i++) {
			const prev = pts[i - 1].ele, cur = pts[i].ele;
			if (prev != null && cur != null) {
				const d = cur - prev;
				if (d > 0) eleGain += d; else eleLoss += Math.abs(d);
			}
		}

		splits.push({ km, paceSecPerKm, avgHr, eleGain: Math.round(eleGain), eleLoss: Math.round(eleLoss) });
	}
	return splits;
}

// --- Cross-source HR lookup ---

async function findCrossSourceHr(userId: string, workoutTime: Date, currentSource: string | null): Promise<CrossSourceHr | null> {
	const window = 2 * 3600 * 1000;
	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout'),
			gte(sensorEvents.timestamp, new Date(workoutTime.getTime() - window)),
			lte(sensorEvents.timestamp, new Date(workoutTime.getTime() + window))
		),
		columns: { data: true, metadata: true }
	});

	for (const row of rows) {
		const source = typeof row.metadata?.source === 'string' ? row.metadata.source : null;
		if (source === currentSource) continue;
		const avg = typeof row.data?.avgHeartRate === 'number' ? row.data.avgHeartRate : null;
		const max = typeof row.data?.maxHeartRate === 'number' ? row.data.maxHeartRate : null;
		const min = typeof row.data?.minHeartRate === 'number' ? row.data.minHeartRate : null;
		if (avg != null || max != null) {
			const sourceName = typeof row.metadata?.sourceName === 'string' ? row.metadata.sourceName : (source ?? 'annen kilde');
			return { sourceName, avgHr: avg ? Math.round(avg) : null, maxHr: max ? Math.round(max) : null, minHr: min ? Math.round(min) : null };
		}
	}
	return null;
}

async function generateWorkoutAssessment(
	workout: NonNullable<Awaited<ReturnType<typeof getWorkoutContextForUser>>>,
	healthGoals: Array<{ title: string; description: string | null; metadata: unknown }>,
	splits: WorkoutSplitForContext[],
	crossSourceHr: CrossSourceHr | null
): Promise<string> {
	const goalsSummary = healthGoals.length > 0
		? healthGoals.map((g) => `- ${g.title}${g.description ? `: ${g.description}` : ''}`).join('\n')
		: 'Ingen aktive helsemål registrert.';

	const contextPrompt = buildWorkoutChatPrompt(workout, splits, crossSourceHr ?? undefined);

	const prompt = `Du er en kort, direkte treningscoach. Vurder denne treningsøkten opp mot brukernes mål. Skriv maksimalt 4 korte setninger. Vær konkret – nevn tall fra økten. Avslutt med ett enkelt råd for neste økt.

Økt:
${contextPrompt}

Aktive helsemål:
${goalsSummary}`;

	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 200,
		temperature: 0.6
	});

	return response.choices[0]?.message?.content?.trim() ?? '';
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.userId;
	const workoutId = params.id;

	const workout = await getWorkoutContextForUser(userId, workoutId);
	if (!workout) throw error(404, 'Treningsøkt ikke funnet');

	const rawEvent = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, workoutId), eq(sensorEvents.userId, userId)),
		columns: { data: true, metadata: true, timestamp: true }
	});

	const trackPoints: TrackPt[] = Array.isArray(rawEvent?.data?.trackPoints) ? rawEvent.data.trackPoints : [];

	// Compute splits from track points
	const splits = computeSplits(trackPoints);

	// Find cross-source HR if this workout has no HR or has track-only HR
	const hasOwnHr = workout.avgHeartRate != null;
	const crossSourceHr = !hasOwnHr && rawEvent?.timestamp
		? await findCrossSourceHr(userId, rawEvent.timestamp, workout.source).catch(() => null)
		: null;

	const healthTheme = await db.query.themes.findFirst({
		where: and(eq(themes.userId, userId), eq(themes.name, 'Helse'))
	});
	const healthGoals = healthTheme
		? await db.query.goals.findMany({
				where: and(
					eq(goals.userId, userId),
					eq(goals.themeId, healthTheme.id),
					inArray(goals.status, ['active', 'paused'])
				),
				columns: { title: true, description: true, metadata: true }
			})
		: [];

	const assessment = await generateWorkoutAssessment(workout, healthGoals, splits, crossSourceHr).catch(() => null);

	return {
		workout,
		trackPoints,
		splits,
		crossSourceHr,
		assessment,
		healthThemeId: healthTheme?.id ?? null,
		healthGoals
	};
};
