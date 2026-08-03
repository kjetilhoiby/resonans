/**
 * Dagsmål for kalorier og protein.
 *
 * Bor i `themes.metricSettings` på Helse-mortemaet, etter samme konvensjon som
 * søvnterskelen: tersklene er felles for helse-familien, og undertemaet leser dem
 * derfra i stedet for å ha sin egen tomme kopi.
 *
 * Trukket ut av `nutrition-dashboard.ts` fordi chat-verktøyet trenger samme tall,
 * og et AI-verktøy skal ikke importere en dashboard-modul for å finne dem.
 */

import { findThemeByName } from '$lib/server/themes';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';

export interface NutritionTargetValues {
	kcal: number | null;
	proteinG: number | null;
}

export async function loadNutritionTargets(userId: string): Promise<NutritionTargetValues> {
	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	const settings = (parent?.metricSettings ?? {}) as Record<string, unknown>;
	const nutrition = (settings.nutrition ?? {}) as Record<string, unknown>;

	// `> 0` med vilje: et mål på 0 kcal er ikke et mål, det er et tomt felt.
	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

	return {
		kcal: num(nutrition.kcalTarget),
		proteinG: num(nutrition.proteinTarget)
	};
}
