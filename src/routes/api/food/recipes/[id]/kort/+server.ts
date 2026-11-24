import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMealCard } from '$lib/server/services/meal-catalog';

// GET /api/food/recipes/[id]/kort — middagskortet: retten, mengder for familien,
// historikken med erfaringer, og duplikater med samme navn (meal-card.ts).
export const GET: RequestHandler = async ({ params, locals }) => {
	const card = await getMealCard(locals.userId, params.id);
	if (!card) return json({ error: 'Fant ikke retten' }, { status: 404 });
	return json(card);
};
