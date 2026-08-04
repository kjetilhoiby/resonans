import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import { saveNutritionTargets, type TargetPatch } from '$lib/server/nutrition/save-targets';
import { TARGET_FIELDS } from '$lib/domain/nutrition/target-settings';

/**
 * Dagsmål og makrobalanse.
 *
 * Ligger i `metricSettings.nutrition` på Helse-mortemaet, som resten av tersklene.
 * Selve skrivingen og valideringen bor i `saveNutritionTargets`, delt med
 * chat-verktøyet `manage_nutrition_targets` — de to skal ikke kunne bli uenige om
 * hva som er en gyldig verdi.
 *
 * Andelene trenger ikke summere til 100 — de er tre uavhengige mål. Men summerer de
 * til noe langt unna, følger en `warning` med svaret.
 */
export const GET: RequestHandler = async ({ locals }) => {
	return json(await loadNutritionTargets(locals.userId));
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Forventet et JSON-objekt.' }, { status: 400 });
	}

	// Bare kjente felt slipper gjennom, slik at en skrivefeil i nøkkelnavnet ikke
	// havner i metricSettings som en rad ingenting leser.
	const patch: TargetPatch = {};
	for (const field of TARGET_FIELDS) {
		if (field in body) patch[field] = body[field];
	}

	const result = await saveNutritionTargets(locals.userId, patch);
	if (!result.ok) return json({ error: result.error }, { status: 400 });

	return json({ ...result.targets, warning: result.warning });
};
