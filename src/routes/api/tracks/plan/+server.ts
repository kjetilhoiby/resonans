import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDefaultPlan } from '$lib/server/tracks/repository';

function num(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Opprett treningsløp med baseline. Tidligere form-action `?/opprett` på
 * /trening — flyttet hit så både siden og Trening-undertemaet kan kalle den.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Ugyldig payload' }, { status: 400 });

	await createDefaultPlan(locals.userId, {
		strengthBaseline: {
			armhevingerPerOkt: num(body.armhevinger),
			plankeSekunder: num(body.planke),
			pullupNegativSekunder: num(body.pullupNegativ)
		},
		enduranceBaseline: {
			ukesKm: num(body.ukesKm),
			paceSekPerKm: num(body.paceSek)
		}
	});

	return json({ success: true });
};
