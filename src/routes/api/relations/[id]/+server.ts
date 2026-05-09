import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const removed = await PersonService.deleteRelation(params.id, locals.userId);
	if (!removed) return json({ error: 'Relasjon ikke funnet' }, { status: 404 });
	return json({ relation: removed });
};
