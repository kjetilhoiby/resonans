import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adjustIntake, deleteIntake } from '$lib/server/nutrition/intake-log';
import { invalidateNutritionAggregates } from '$lib/server/nutrition/aggregate-refresh';

function finite(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
	return null;
}

/** Retter makroene på et loggført måltid. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });

	const kcal = finite(body.kcal);
	const proteinG = finite(body.proteinG);
	const carbsG = finite(body.carbsG);
	const fatG = finite(body.fatG);

	if (kcal == null || proteinG == null || carbsG == null || fatG == null) {
		return json({ error: 'Alle fire makroene må være tall som ikke er negative.' }, { status: 400 });
	}

	const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined;
	const ok = await adjustIntake(locals.userId, params.id, { kcal, proteinG, carbsG, fatG }, label);
	if (!ok) return json({ error: 'Fant ikke måltidet.' }, { status: 404 });

	await invalidateNutritionAggregates(locals.userId).catch((err) =>
		console.error('[ernæring] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const ok = await deleteIntake(locals.userId, params.id);
	if (!ok) return json({ error: 'Fant ikke måltidet.' }, { status: 404 });

	await invalidateNutritionAggregates(locals.userId).catch((err) =>
		console.error('[ernæring] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true });
};
