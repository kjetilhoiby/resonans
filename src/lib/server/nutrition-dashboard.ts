import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq, lte } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { averagePerLoggedDay, groupByDay, osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { computeEnergyBalance } from '$lib/domain/nutrition/energy-balance';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import { loadExpenditureContext } from '$lib/server/nutrition/expenditure';
import { describeExpenditure } from '$lib/domain/nutrition/expenditure-breakdown';
import { checkAgainstWeight } from '$lib/domain/nutrition/weight-reality-check';
import { estimateDailyExpenditure } from '$lib/domain/health/energy-expenditure';
import { ageFromBirthYear, readBodyProfile } from '$lib/server/health/body-profile';
import { canonicalWorkouts } from '$lib/db/schema';
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

	const [weightAggregates, foodTheme, entries, targets, withings, bodyProfile, todayWorkouts] =
		await Promise.all([
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
		loadWithingsContext(userId, today),
		readBodyProfile(userId),
		loadTodayWorkouts(userId, today)
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
		/**
		 * Hva «forbrent» består av. Ett tall kan ikke etterprøves, og 3. august ga
		 * Withings komponenter som ikke summerte til sin egen total.
		 */
		expenditureBreakdown:
			withings.expenditureKcal === null
				? null
				: describeExpenditure({
						totalKcal: withings.expenditureKcal,
						reportedActivityKcal: withings.activityKcal,
						basalKcal: withings.basalKcal,
						workoutKcal: withings.workoutKcal,
						// Dagen er alltid delvis her: flaten viser i dag.
						partialDay: true
					}),
		/**
		 * Vårt eget forbruksestimat, uavhengig av Withings. Null når kroppsprofilen
		 * mangler — vi gjetter ikke på høyde eller alder.
		 */
		ownExpenditure: estimateDailyExpenditure({
			profile: {
				weightKg: withings.weightPoints[0]?.kg ?? undefined,
				heightCm: bodyProfile.heightCm ?? undefined,
				ageYears: ageFromBirthYear(bodyProfile.birthYear) ?? undefined,
				sex: bodyProfile.sex ?? undefined
			},
			workouts: todayWorkouts,
			deskJobFactor: bodyProfile.deskJobFactor ?? undefined
		}),
		/** Hva som mangler for å kunne regne selv. Tom liste = alt på plass. */
		ownExpenditureMissing: [
			withings.weightPoints[0]?.kg ? null : 'vekt',
			bodyProfile.heightCm ? null : 'høyde',
			bodyProfile.birthYear ? null : 'fødselsår',
			bodyProfile.sex ? null : 'kjønn'
		].filter((item): item is string => item !== null),
		/**
		 * Vekta som dommer over regnestykket. Et underskudd som ikke gir vektnedgang
		 * er feil, uansett hvor pent det er satt opp — og feilen kan ligge på begge
		 * sider. Se weight-reality-check.
		 */
		realityCheck: checkAgainstWeight({
			balances: groupByDay(entries).flatMap((day) => {
				const expenditureKcal = withings.expenditureByDay.find(
					(row) => row.dateKey === day.date
				)?.totalKcal;
				if (typeof expenditureKcal !== 'number') return [];
				const balance = computeEnergyBalance({
					intakeKcal: summarizeDay(day.date, day.entries, targets).totals.kcal,
					expenditureKcal,
					// Historiske dager er komplette; bare i dag vokser fortsatt.
					partialDay: day.date === today
				});
				return balance ? [{ date: day.date, balanceKcal: balance.balanceKcal }] : [];
			}),
			weights: withings.weightPoints
		}),
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

	const [weightRows] = await Promise.all([
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

	// Forbruket leses gjennom den delte loaderen, som også gir komponentene og en
	// utledet hvileforbrenning. Duplisert her ville valget mellom `calories` og
	// `totalCalories` bodd på to steder.
	const expenditure = await loadExpenditureContext(userId, todayKey);

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
		expenditureKcal: expenditure.totalKcal,
		activityKcal: expenditure.activityKcal,
		basalKcal: expenditure.basalKcal,
		workoutKcal: expenditure.workoutKcal,
		expenditureByDay: expenditure.byDay,
		weightPoints: weightRows.flatMap((row) => {
			const kg = (row.data as { weight?: unknown } | null)?.weight;
			if (typeof kg !== 'number' || !Number.isFinite(kg)) return [];
			return [{ date: osloDateKey(row.timestamp), kg }];
		}),
		composition: latest?.composition ?? null,
		compositionDate: latest?.at ?? null,
		compositionChange: latest && oldest ? describeCompositionChange(oldest, latest) : null
	};
}

/**
 * Dagens økter, til vårt eget forbruksestimat.
 *
 * Fra `canonical_workouts` og ikke fra Withings' dagsrad: det er sportstypen og
 * varigheten vi trenger, og den kanoniske raden er dedupliserende. Vinduet er
 * romslig i UTC og filtreres deretter på Oslo-dato, siden døgnskillet ikke er det
 * samme.
 */
async function loadTodayWorkouts(userId: string, todayKey: string) {
	const dayStart = new Date(`${todayKey}T00:00:00.000Z`);
	const rows = await db.query.canonicalWorkouts.findMany({
		columns: { startTime: true, sportType: true, durationSeconds: true, distanceMeters: true },
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, new Date(dayStart.getTime() - 12 * 60 * 60 * 1000)),
			lte(canonicalWorkouts.startTime, new Date(dayStart.getTime() + 36 * 60 * 60 * 1000))
		)
	});

	return rows
		.filter((row) => osloDateKey(row.startTime) === todayKey)
		.map((row) => ({
			sportType: row.sportType,
			durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : null,
			distanceMeters: row.distanceMeters ? Number(row.distanceMeters) : null
		}));
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
