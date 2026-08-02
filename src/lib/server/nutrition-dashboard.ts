import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { averagePerLoggedDay, osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';

/**
 * Ernæring-undertemaet.
 *
 * Flaten var en skalflate fram til august 2026: ingenting logget inntak, så det
 * fantes ingen ernæringsdata å vise. Nå eier den inntaksloggen — fritekst eller
 * bilde, estimert av modellen mot en norsk referansetabell.
 *
 * Dagens tall leses rett fra loggen framfor fra dagsaggregatet, av to grunner:
 * det er alltid ferskt rett etter en logging, og `aggregateDailyEffort` skriver
 * `metrics` i sin helhet på dagsradene og ville overskrevet et nutrition-felt der.
 *
 * Vektserien blir liggende: den er utfallet kostholdet påvirker. Selve
 * effort→vekt-modellen bor på Trening (effort → effekt).
 */
export async function loadNutritionDashboardData(userId: string, theme: { name: string; emoji: string | null }) {
	const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

	const [weightAggregates, foodTheme, entries, targets] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 24
		}),
		// Mat-temaet er nærmeste nabo. Vi lenker dit fra flaten i stedet for å
		// duplisere ukemeny og lager inn i Ernæring.
		findMatchingFoodTheme(userId),
		listIntake(userId, { since }),
		loadNutritionTargets(userId)
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

	const today = osloDateKey(new Date());
	const todayEntries = entries.filter((entry) => osloDateKey(entry.timestamp) === today);

	return {
		themeName: theme.name,
		themeEmoji: theme.emoji,
		foodThemeId: foodTheme?.id ?? null,
		foodThemeName: foodTheme?.name ?? null,
		weight,
		targets,
		today: summarizeDay(today, todayEntries, targets),
		/** Siste 14 dager, nyeste først. Mater både historikken og snittet. */
		recent: entries,
		average: averagePerLoggedDay(entries)
	};
}

/**
 * Dagsmål for kalorier og protein.
 *
 * Bor i `themes.metricSettings` på Helse-mortemaet, etter samme konvensjon som
 * søvnterskelen: tersklene er felles for helse-familien, og undertemaet leser
 * dem derfra i stedet for å ha sin egen tomme kopi.
 */
async function loadNutritionTargets(userId: string): Promise<{ kcal: number | null; proteinG: number | null }> {
	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	const settings = (parent?.metricSettings ?? {}) as Record<string, unknown>;
	const nutrition = (settings.nutrition ?? {}) as Record<string, unknown>;

	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

	return { kcal: num(nutrition.kcalTarget), proteinG: num(nutrition.proteinTarget) };
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
