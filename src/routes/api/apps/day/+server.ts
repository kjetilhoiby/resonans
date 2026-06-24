import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gatherDayContext, getActiveTripForDate } from '$lib/server/day-location-context';
import { getProgramSummaries, getTodaySession } from '$lib/server/programs/repository';

/**
 * GET /api/apps/day?date=YYYY-MM-DD   (default i dag, brukerens tidssone)
 *
 * Dagens plan til Ekko i ett kall — en tynn lese-komposisjon (BFF) over
 * eksisterende kilder: bevegelse/opphold (delt med chat via gatherDayContext),
 * aktiv tur (utledet fra datoen, samme inferens som live-session-ankomst), og en
 * tynn peker til dagens treningsøkt. Erstatter IKKE program-API-et: Ekko driller
 * ned i /programs/[id]/today for sett/reps/fullføring og rapporterer via
 * complete-session. Bevegelse rapporteres via live-session 'arrived'.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

	const ctx = await gatherDayContext(userId, date);

	// Aktiv tur fra datoen (Ekko trenger ikke kjenne tema-taksonomien). Delt helper med assistenten.
	const trip = await getActiveTripForDate(userId, ctx.date);

	return json({
		date: ctx.date,
		trip,
		movement: ctx.movement,
		stay: ctx.stay,
		training: await buildTrainingPointer(userId, ctx.date)
	});
};

/**
 * Tynn peker til dagens planlagte økt i det aktive programmet — ikke hele økten.
 * Ekko bruker `programId` til å hente full økt via /programs/[id]/today.
 * Returnerer null hvis ingen aktivt program eller ingen økt i dag.
 */
async function buildTrainingPointer(userId: string, date: string) {
	try {
		const programs = await getProgramSummaries(userId);
		const active = programs.find((p) => p.status === 'active');
		if (!active) return null;

		const today = await getTodaySession(userId, active.id, date);
		if (!today) return { programId: active.id, sessionId: null, kind: null, name: null, done: false };

		return {
			programId: active.id,
			sessionId: today.session.id,
			kind: today.session.kind,
			name: today.session.name,
			done: today.session.completion != null
		};
	} catch (err) {
		console.warn('[apps/day] training pointer failed:', err);
		return null;
	}
}
