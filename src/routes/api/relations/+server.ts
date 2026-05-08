import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';
import { isValidRelationType, type RelationType, type RelationSubType } from '$lib/domains/family';

export const GET: RequestHandler = async ({ locals }) => {
	const list = await PersonService.listRelations(locals.userId);
	return json({ relations: list });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	if (!body.toPersonId || typeof body.toPersonId !== 'string') {
		return json({ error: 'toPersonId is required' }, { status: 400 });
	}
	if (!body.relationType || !isValidRelationType(body.relationType)) {
		return json({ error: 'relationType must be family|friend|work' }, { status: 400 });
	}
	const created = await PersonService.createRelation({
		userId: locals.userId,
		fromPersonId: body.fromPersonId ?? null,
		toPersonId: body.toPersonId,
		relationType: body.relationType as RelationType,
		subType: (body.subType as RelationSubType | null) ?? null,
		closeness: body.closeness ?? null,
		notes: body.notes ?? null
	});
	return json({ relation: created }, { status: created ? 201 : 200 });
};
