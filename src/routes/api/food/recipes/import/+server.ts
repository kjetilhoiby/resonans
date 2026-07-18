import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importRecipeFromUrl } from '$lib/server/services/recipe-import-service';

// POST /api/food/recipes/import — importer oppskrift fra URL.
// Body: { url: string }. Logikken bor i recipe-import-service (delt med
// find_recipes-AI-verktøyet).
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));

	const result = await importRecipeFromUrl(userId, body.url);
	if (!result.ok) {
		return json({ error: result.error }, { status: result.status });
	}
	return json({ meal: result.meal }, { status: 201 });
};
