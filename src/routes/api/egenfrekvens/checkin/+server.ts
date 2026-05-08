import { json } from '@sveltejs/kit';
import {
	EgenfrekvensCheckinError,
	getEgenfrekvensCheckinStatus,
	submitEgenfrekvensCheckin,
	toIsoDay
} from '$lib/server/egenfrekvens-checkin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const dayParam = url.searchParams.get('day');
	const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : toIsoDay();
	const status = await getEgenfrekvensCheckinStatus(locals.userId, day);
	return json(status);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const balance = Number(body?.balance);
		const thoughts = Number(body?.thoughts);
		const feelings = Number(body?.feelings);
		const actions = Number(body?.actions);
		const note = typeof body?.note === 'string' ? body.note : null;
		const reflection = typeof body?.reflection === 'string' ? body.reflection : null;
		const day =
			typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : toIsoDay();

		const status = await submitEgenfrekvensCheckin({
			userId: locals.userId,
			balance,
			thoughts,
			feelings,
			actions,
			note,
			reflection,
			day
		});

		return json(status);
	} catch (error) {
		if (error instanceof EgenfrekvensCheckinError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('Failed to submit egenfrekvens check-in:', error);
		return json({ error: 'Kunne ikke lagre egenfrekvens-sjekkin.' }, { status: 500 });
	}
};
