import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logStreakRound } from '$lib/server/services/streak-service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/streaks/[id]/log — registrer en gjennomført runde (manuelle streaks)
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));
	const rawDate = (body as { date?: unknown }).date;

	// Etterregistrering: 'YYYY-MM-DD' tolkes som midt på dagen, så Oslo-lokal
	// dagsnøkkel blir den samme datoen uansett sommer-/vintertid.
	let at: Date | undefined;
	if (typeof rawDate === 'string' && ISO_DATE.test(rawDate)) {
		at = new Date(`${rawDate}T12:00:00Z`);
	}

	try {
		const eventId = await logStreakRound(userId, params.id, at);
		return json({ ok: true, eventId }, { status: 201 });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'kunne ikke logge runde');
	}
};
