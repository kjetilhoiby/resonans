import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';
import { SpondPersonMappingService } from '$lib/server/services/spond-person-mapping-service';
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
	const before = await PersonService.getById(params.id, locals.userId);
	const updated = await PersonService.update(params.id, locals.userId, body);
	if (!updated) return json({ error: 'Person ikke funnet' }, { status: 404 });

	let backfilled = 0;
	if (Array.isArray(body.spondGroupIds) && before) {
		const added = body.spondGroupIds.filter((g: string) => !before.spondGroupIds.includes(g));
		if (added.length > 0) {
			const result = await SpondPersonMappingService.tagEventsForPerson(locals.userId, params.id);
			backfilled = result.tagged;
		}
	}

	return json({ person: updated, backfilled });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const archived = await PersonService.archive(params.id, locals.userId);
	if (!archived) return json({ error: 'Person ikke funnet' }, { status: 404 });
	return json({ person: archived });
};
