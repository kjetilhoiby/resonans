import { json } from '@sveltejs/kit';
import {
	getRelationshipCheckinStatus,
	RelationshipCheckinError,
	submitRelationshipCheckin,
	toIsoDay
} from '$lib/server/relationship-checkin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const dayParam = url.searchParams.get('day');
	const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : toIsoDay();
	const status = await getRelationshipCheckinStatus(locals.userId, day);
	return json(status);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const score = Number(body?.score);
		const note = typeof body?.note === 'string' ? body.note : null;
		const day = typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
			? body.day
			: toIsoDay();

		const status = await submitRelationshipCheckin({
			userId: locals.userId,
			score,
			note,
			day
		});

		return json(status);
	} catch (error) {
		if (error instanceof RelationshipCheckinError) {
			return json({ error: error.message }, { status: 400 });
		}

		console.error('Failed to submit relationship check-in:', error);
		return json({ error: 'Kunne ikke lagre parsjekk.' }, { status: 500 });
	}
};
