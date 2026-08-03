import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { averagePerLoggedDay, osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { computeEnergyBalance } from '$lib/domain/nutrition/energy-balance';
import { normalizeBodyComposition, describeCompositionChange } from '$lib/domain/health/body-composition';
import { sensorEvents } from '$lib/db/schema';
import { gte } from 'drizzle-orm';

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

	const today = osloDateKey(new Date());

	const [weightAggregates, foodTheme, entries, targets, withings] = await Promise.all([
		db.query.sensorAggregates.findMany({
			where: and(eq(sensorAggregates.userId, userId), eq(sensorAggregates.period, 'month')),
			orderBy: [desc(sensorAggregates.startDate)],
			limit: 24
		}),
		// Mat-temaet er nærmeste nabo. Vi lenker dit fra flaten i stedet for å
		// duplisere ukemeny og lager inn i Ernæring.
		findMatchingFoodTheme(userId),
		listIntake(userId, { since }),
		loadNutritionTargets(userId),
		loadWithingsContext(userId, today)
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

	const todayEntries = entries.filter((entry) => osloDateKey(entry.timestamp) === today);
	const todaySummary = summarizeDay(today, todayEntries, targets);

	return {
		themeName: theme.name,
		themeEmoji: theme.emoji,
		foodThemeId: foodTheme?.id ?? null,
		foodThemeName: foodTheme?.name ?? null,
		weight,
		targets,
		today: todaySummary,
		/** Spist mot forbrent. Null når én av sidene mangler — se computeEnergyBalance. */
		energyBalance: computeEnergyBalance({
			intakeKcal: todaySummary.totals.kcal,
			expenditureKcal: withings.expenditureKcal,
			// Dagen er ikke omme før midnatt Oslo-tid, så begge tallene er delvise.
			partialDay: true
		}),
		composition: withings.composition,
		compositionDate: withings.compositionDate,
		compositionChange: withings.compositionChange,
		/** Siste 14 dager, nyeste først. Mater både historikken og snittet. */
		recent: entries,
		average: averagePerLoggedDay(entries)
	};
}

/**
 * Dagens forbruk fra Withings, og kroppssammensetningen.
 *
 * `totalcalories` er hvileforbrenning + aktivitet — den andre siden av
 * energibalansen ernæringsloggen måler. `calories` alene er bare aktiviteten og
 * ville gitt et voldsomt underskudd hver dag.
 *
 * Kroppssammensetningen er grunnen til at det er verdt å hente mer enn vekt:
 * «ned 1,4 kg» og «ned 1,4 kg hvorav 0,9 er muskel» er to helt ulike beskjeder.
 */
async function loadWithingsContext(userId: string, todayKey: string) {
	const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

	const [activityRows, weightRows] = await Promise.all([
		db.query.sensorEvents.findMany({
			columns: { timestamp: true, data: true },
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'activity'),
				gte(sensorEvents.timestamp, since)
			),
			orderBy: [desc(sensorEvents.timestamp)],
			limit: 70
		}),
		db.query.sensorEvents.findMany({
			columns: { timestamp: true, data: true },
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, since)
			),
			orderBy: [desc(sensorEvents.timestamp)],
			limit: 120
		})
	]);

	// Aktivitetsraden er datert til UTC-midnatt for brukerens lokale dag, så
	// dagsnøkkelen sammenlignes direkte.
	const todayActivity = activityRows.find(
		(row) => row.timestamp.toISOString().slice(0, 10) === todayKey
	);
	const expenditureKcal =
		typeof (todayActivity?.data as { totalCalories?: unknown })?.totalCalories === 'number'
			? ((todayActivity!.data as { totalCalories: number }).totalCalories)
			: null;

	const compositions = weightRows.flatMap((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const weightKg = typeof data.weight === 'number' ? data.weight : null;
		if (weightKg === null) return [];
		return [
			{
				at: row.timestamp.toISOString(),
				weightKg,
				composition: normalizeBodyComposition({
					weightKg,
					fatMassKg: typeof data.fatMassKg === 'number' ? data.fatMassKg : null,
					fatRatio: typeof data.fatRatio === 'number' ? data.fatRatio : null,
					legacyFatMass: typeof data.fatMass === 'number' ? data.fatMass : null,
					muscleMassKg: typeof data.muscleMass === 'number' ? data.muscleMass : null,
					fatFreeMassKg: typeof data.fatFreeMass === 'number' ? data.fatFreeMass : null,
					boneMassKg: typeof data.boneMass === 'number' ? data.boneMass : null,
					hydrationKg: typeof data.hydration === 'number' ? data.hydration : null
				})
			}
		];
	});

	const latest = compositions[0] ?? null;
	const oldest = compositions.length > 1 ? compositions[compositions.length - 1] : null;

	return {
		expenditureKcal,
		composition: latest?.composition ?? null,
		compositionDate: latest?.at ?? null,
		compositionChange: latest && oldest ? describeCompositionChange(oldest, latest) : null
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
