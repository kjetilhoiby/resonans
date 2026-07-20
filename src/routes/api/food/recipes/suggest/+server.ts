import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { suggestRecipe } from '$lib/server/services/recipe-suggest-service';

// POST /api/food/recipes/suggest — generér eller forbedre et oppskriftsforslag
// fra rettnavn + familiekontekst. Lagrer ingenting; klienten fyller skjemaet.
// Body: { title, current?, instruction? }
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));

	const result = await suggestRecipe(userId, {
		title: body.title,
		current: body.current ?? null,
		instruction: body.instruction ?? null
	});

	if (!result.ok) return json({ error: result.error }, { status: result.status });
	return json({ suggestion: result.suggestion });
};
