import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	LivskompassCheckinError,
	getLivskompassStatus,
	submitLivskompassCheckin
} from '$lib/server/livskompass-checkin';
import { isValidWeekKey, localIsoWeek } from '$lib/domains/livskompass/dimensions';
import { isNonWorkingDay } from '$lib/server/norwegian-holidays';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const weekParam = url.searchParams.get('week');
	const week = isValidWeekKey(weekParam) ? weekParam : localIsoWeek();
	const status = await getLivskompassStatus(locals.userId, week);
	// Helgegate: kompasset tilbys i helga (lør/søn eller helligdag).
	return json({ ...status, isWeekendNow: isNonWorkingDay(new Date()) });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const eventId = url.searchParams.get('id');
	if (!eventId) return json({ error: 'Mangler id' }, { status: 400 });

	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, eventId),
				eq(sensorEvents.userId, locals.userId),
				eq(sensorEvents.dataType, 'livskompass_checkin')
			)
		)
		.returning({ id: sensorEvents.id });

	if (deleted.length === 0) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const status = await submitLivskompassCheckin({
			userId: locals.userId,
			week: body?.week,
			scores: body?.scores,
			note: typeof body?.note === 'string' ? body.note : null
		});
		return json(status);
	} catch (error) {
		if (error instanceof LivskompassCheckinError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('Failed to submit livskompass check-in:', error);
		return json({ error: 'Kunne ikke lagre livskompass-innsjekk.' }, { status: 500 });
	}
};
