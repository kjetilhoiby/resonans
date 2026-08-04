/**
 * Skrivingen av dagsmålene, delt av endepunktet og chat-verktøyet.
 *
 * Begge må gjøre nøyaktig det samme: validere mot `target-settings`, bevare
 * `metricSettings`-nøkler de ikke eier, og svare med det som faktisk står lagret.
 * Duplisert ville chatten kunnet lagre uten å bevare nøkler — nettopp feilen
 * `PUT /api/tema/[id]/metric-settings` gjorde i august, da den bygde hele objektet
 * fra sin egen whitelist og slettet `nutrition`-målene.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { loadNutritionTargets, type NutritionTargetValues } from '$lib/server/nutrition/targets';
import {
	macroPctWarning,
	validateTargetField,
	TARGET_FIELDS,
	type TargetField
} from '$lib/domain/nutrition/target-settings';

export type TargetPatch = Partial<Record<TargetField, number | null>>;

export type SaveTargetsResult =
	| { ok: true; targets: NutritionTargetValues; warning: string | null }
	| { ok: false; error: string };

/**
 * Lagrer de feltene som er med i `patch`. Feltene som ikke er med, står.
 *
 * Delvis oppdatering med vilje: «sett proteinmålet til 180» skal ikke måtte sende
 * kalorimålet tilbake for å bevare det.
 */
export async function saveNutritionTargets(
	userId: string,
	patch: TargetPatch
): Promise<SaveTargetsResult> {
	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	if (!parent) {
		return { ok: false, error: 'Fant ingen Helse-tema å lagre målene på.' };
	}

	const current = (parent.metricSettings ?? {}) as Record<string, unknown>;
	const nutrition = { ...((current.nutrition ?? {}) as Record<string, unknown>) };

	let touched = false;
	for (const field of TARGET_FIELDS) {
		if (!(field in patch)) continue;
		const value = patch[field];
		const error = validateTargetField(field, value);
		if (error) return { ok: false, error };

		if (value === null) delete nutrition[field];
		else nutrition[field] = value;
		touched = true;
	}

	if (touched) {
		await db
			.update(themes)
			// Spread av `current`: alt annet i metricSettings — søvnterskler, makspuls,
			// kroppsprofil — skal overleve en måljustering.
			.set({ metricSettings: { ...current, nutrition }, updatedAt: new Date() })
			.where(eq(themes.id, parent.id));
	}

	const targets = await loadNutritionTargets(userId);
	return { ok: true, targets, warning: macroPctWarning(targets) };
}
