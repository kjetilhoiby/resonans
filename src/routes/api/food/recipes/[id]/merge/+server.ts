import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mergeMeals } from '$lib/server/services/meal-catalog';

// POST /api/food/recipes/[id]/merge { duplicateId } — slå duplikaten inn i denne
// retten. Planrader og koblinger flyttes, så historikken bevares; duplikaten slettes.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const duplicateId = typeof body.duplicateId === 'string' ? body.duplicateId : null;
	if (!duplicateId) return json({ error: 'duplicateId er påkrevd' }, { status: 400 });

	const result = await mergeMeals(locals.userId, params.id, duplicateId);
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json(result);
};
