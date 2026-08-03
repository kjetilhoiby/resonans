import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteIntake, updateIntake, type UpdateIntakeInput } from '$lib/server/nutrition/intake-log';
import { invalidateNutritionAggregates } from '$lib/server/nutrition/aggregate-refresh';
import { isMealSlotId } from '$lib/domain/nutrition/meal-slots';

function finite(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
	return null;
}

/**
 * Retter et loggført måltid. Delvis oppdatering — send bare det som endres.
 *
 * Typisk tilfelle: du spiste lunsj kl. 11 men logget 13. Da sendes bare
 * `timestamp`, og sloten følger med (med mindre du har valgt en selv).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });

	const update: UpdateIntakeInput = {};

	if (body.timestamp !== undefined) {
		const parsed = new Date(String(body.timestamp));
		if (Number.isNaN(parsed.getTime())) {
			return json({ error: 'Ugyldig tidspunkt.' }, { status: 400 });
		}
		// Bare bakover. Et måltid i framtiden ville ligget i en periode som ikke
		// er begynt, og dagssummene ville sluttet å stemme.
		if (parsed > new Date()) {
			return json({ error: 'Tidspunktet kan ikke være i framtiden.' }, { status: 400 });
		}
		update.timestamp = parsed;
	}

	if (body.mealSlot !== undefined) {
		if (!isMealSlotId(body.mealSlot)) {
			return json({ error: 'Ukjent måltidsslot.' }, { status: 400 });
		}
		update.mealSlot = body.mealSlot;
	}

	if (body.label !== undefined) {
		const label = String(body.label).trim();
		if (!label) return json({ error: 'Tittelen kan ikke være tom.' }, { status: 400 });
		update.label = label;
	}

	// Makroer er alt-eller-ingenting: en delvis makro-rettelse ville gitt en sum
	// som ikke stemmer med delene.
	const hasAnyMacro = ['kcal', 'proteinG', 'carbsG', 'fatG'].some((key) => body[key] !== undefined);
	if (hasAnyMacro) {
		const kcal = finite(body.kcal);
		const proteinG = finite(body.proteinG);
		const carbsG = finite(body.carbsG);
		const fatG = finite(body.fatG);
		if (kcal == null || proteinG == null || carbsG == null || fatG == null) {
			return json(
				{ error: 'Alle fire makroene må være tall som ikke er negative.' },
				{ status: 400 }
			);
		}
		update.macros = { kcal, proteinG, carbsG, fatG };
	}

	if (Object.keys(update).length === 0) {
		return json({ error: 'Ingenting å endre.' }, { status: 400 });
	}

	const result = await updateIntake(locals.userId, params.id, update);
	if (!result) return json({ error: 'Fant ikke måltidet.' }, { status: 404 });

	// Begge periodene må re-aggregeres når måltidet er flyttet over en grense.
	const earliest =
		result.previousTimestamp < result.timestamp ? result.previousTimestamp : result.timestamp;
	await invalidateNutritionAggregates(locals.userId, earliest).catch((err) =>
		console.error('[ernæring] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true, timestamp: result.timestamp.toISOString() });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const ok = await deleteIntake(locals.userId, params.id);
	if (!ok) return json({ error: 'Fant ikke måltidet.' }, { status: 404 });

	await invalidateNutritionAggregates(locals.userId).catch((err) =>
		console.error('[ernæring] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true });
};
