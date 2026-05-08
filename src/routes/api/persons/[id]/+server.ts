import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';
import { isValidPersonKind } from '$lib/domains/family';

export const GET: RequestHandler = async ({ locals, params }) => {
	const person = await PersonService.getById(params.id, locals.userId);
	if (!person) return json({ error: 'Person ikke funnet' }, { status: 404 });
	return json({ person });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json();
	if (body.kind && !isValidPersonKind(body.kind)) {
		return json({ error: 'Ugyldig kind' }, { status: 400 });
	}
	const updated = await PersonService.update(params.id, locals.userId, body);
	if (!updated) return json({ error: 'Person ikke funnet' }, { status: 404 });
	return json({ person: updated });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const archived = await PersonService.archive(params.id, locals.userId);
	if (!archived) return json({ error: 'Person ikke funnet' }, { status: 404 });
	return json({ person: archived });
};
