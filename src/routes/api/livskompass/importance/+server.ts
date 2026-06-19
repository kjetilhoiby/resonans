import { json } from '@sveltejs/kit';
import { LivskompassCheckinError, submitLivskompassImportance } from '$lib/server/livskompass-checkin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const status = await submitLivskompassImportance({
			userId: locals.userId,
			importance: body?.importance
		});
		return json(status);
	} catch (error) {
		if (error instanceof LivskompassCheckinError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('Failed to save livskompass importance:', error);
		return json({ error: 'Kunne ikke lagre viktighet.' }, { status: 500 });
	}
};
