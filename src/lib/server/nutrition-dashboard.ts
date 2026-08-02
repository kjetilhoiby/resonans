import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

/**
 * Ernæring-undertemaet.
 *
 * NB: dette er bevisst en tynn flate. Ingenting i Resonans logger inntak,
 * makroer eller kalorier ennå, så det finnes ingen ernæringsdata å vise.
 * Undertemaet eksisterer for å ha et sted å samle kostholdssamtalen, målene og
 * filene — og for at strukturen skal være på plass den dagen en kilde kommer.
 *
 * Vektserien tas med som eneste faktiske tall: den er utfallet kostholdet
 * påvirker. Selve effort→vekt-modellen bor på Trening (effort → effekt).
 */
export async function loadNutritionDashboardData(userId: string, theme: { name: string; emoji: string | null }) {
	const [weightAggregates, foodTheme] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 24
		}),
		// Mat-temaet er nærmeste nabo. Vi lenker dit fra tomtilstanden i stedet
		// for å duplisere ukemeny og lager inn i Ernæring.
		findMatchingFoodTheme(userId)
	]);

	const weight = weightAggregates
		.slice()
		.reverse()
		.flatMap((row) => {
			const metrics = row.metrics as { weight?: { avg?: number; change?: number } } | null;
			const avg = metrics?.weight?.avg;
			if (typeof avg !== 'number') return [];
			return [{ periodKey: row.periodKey, avg, change: metrics?.weight?.change ?? null }];
		});

	return {
		themeName: theme.name,
		themeEmoji: theme.emoji,
		foodThemeId: foodTheme?.id ?? null,
		foodThemeName: foodTheme?.name ?? null,
		weight
	};
}

/** Brukerens mat-tema, om det finnes. Navnet er ikke gitt, så vi matcher på kind. */
async function findMatchingFoodTheme(userId: string) {
	for (const name of ['Mat', 'Matplan', 'Middag']) {
		const theme = await findThemeByName(userId, name);
		if (theme && resolveThemeDashboardKind(theme.name) === 'food') return theme;
	}
	return null;
}

export type NutritionDashboardPayload = Awaited<ReturnType<typeof loadNutritionDashboardData>>;
