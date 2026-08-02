import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensorEvents, goals, tasks } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { findHealthThemeId, getHealthThemeIds } from '$lib/server/themes';

async function generateWorkoutAssessment(
	workout: NonNullable<Awaited<ReturnType<typeof getWorkoutContextForUser>>>,
	healthGoals: Array<{ title: string; description: string | null; metadata: unknown }>
): Promise<string> {
	const goalsSummary = healthGoals.length > 0
		? healthGoals.map((g) => `- ${g.title}${g.description ? `: ${g.description}` : ''}`).join('\n')
		: 'Ingen aktive helsemål registrert.';

	const distanceKm = workout.distanceKm != null ? `${workout.distanceKm.toFixed(2)} km` : null;
	const durationMin = workout.durationSeconds != null ? Math.round(workout.durationSeconds / 60) : null;
	const pace = workout.paceSecondsPerKm != null
		? `${Math.floor(workout.paceSecondsPerKm / 60)}:${String(Math.round(workout.paceSecondsPerKm % 60)).padStart(2, '0')} /km`
		: null;

	const lines = [
		`Treningsøkt: ${workout.title}`,
		distanceKm && `Distanse: ${distanceKm}`,
		durationMin && `Varighet: ${durationMin} min`,
		pace && `Tempo: ${pace}`,
		workout.elevationMeters != null && `Høydemeter: ${Math.round(workout.elevationMeters)} m`,
		workout.avgHeartRate != null && `Snitt puls: ${Math.round(workout.avgHeartRate)} bpm`,
		workout.maxHeartRate != null && `Maks puls: ${Math.round(workout.maxHeartRate)} bpm`,
	].filter(Boolean).join('\n');

	const prompt = `Du er en kort, direkte treningscoach. Vurder denne treningsøkten opp mot brukernes mål. Skriv maksimalt 4 korte setninger. Vær konkret – nevn tall fra økten. Avslutt med ett enkelt råd for neste økt.

Økt:
${lines}

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
	if (!workout) {
		throw error(404, 'Treningsøkt ikke funnet');
	}

	// Hent trackpoints fra rå data
	const rawEvent = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, workoutId),
			eq(sensorEvents.userId, userId)
		),
		columns: { data: true, metadata: true }
	});

	const trackPoints = Array.isArray(rawEvent?.data?.trackPoints) ? rawEvent.data.trackPoints : [];

	// Hent helsemål fra hele helse-familien: et treningsmål kan like gjerne ligge
	// på Trening-undertemaet som på mortemaet.
	const [healthThemeId, healthThemeIds] = await Promise.all([
		findHealthThemeId(userId),
		getHealthThemeIds(userId)
	]);
	const healthGoals = healthThemeIds.length
		? await db.query.goals.findMany({
				where: and(
					eq(goals.userId, userId),
					inArray(goals.themeId, healthThemeIds),
					inArray(goals.status, ['active', 'paused'])
				),
				columns: { title: true, description: true, metadata: true }
			})
		: [];

	// Generer LLM-vurdering
	const assessment = await generateWorkoutAssessment(workout, healthGoals).catch(() => null);

	return {
		workout,
		trackPoints,
		assessment,
		healthThemeId,
		healthGoals
	};
};
