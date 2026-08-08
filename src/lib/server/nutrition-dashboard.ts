import { db } from '$lib/db';
import { sensorAggregates } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { findThemeByName } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { averagePerLoggedDay, groupByDay, osloDateKey, summarizeDay } from '$lib/domain/nutrition/day-summary';
import { HEALTH_PARENT_THEME_NAME } from '$lib/domain/health-subthemes';
import { computeEnergyBalance } from '$lib/domain/nutrition/energy-balance';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import { checkAgainstWeight } from '$lib/domain/nutrition/weight-reality-check';
import { buildDailyBalances } from '$lib/domain/nutrition/daily-balances';
import { HISTORY_DAYS, loadEnergyContext } from '$lib/server/nutrition/energy-context';
import { evaluateMacroTargets } from '$lib/domain/nutrition/macro-targets';
import { repeatableMeals } from '$lib/domain/nutrition/repeat-meals';
import { describeIntakePacing, osloHourNow } from '$lib/domain/nutrition/intake-pacing';
import { buildHistorySeries } from '$lib/domain/nutrition/history-series';
import { loadIntradayEnergy } from '$lib/server/nutrition/intraday';
import { listHunger } from '$lib/server/nutrition/hunger-log';
import { predictHunger } from '$lib/domain/nutrition/hunger';

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
/** Historikkvinduet bor hos energikonteksten, som chat-verktøyet også leser det fra. */
export { HISTORY_DAYS };

export async function loadNutritionDashboardData(userId: string, theme: { name: string; emoji: string | null }) {
	const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

	const today = osloDateKey(new Date());

	const [weightAggregates, foodTheme, entries, targets, energy, intraday, hungerHistory] =
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
			// Forbruket, kilden det kom fra, og vekta. Delt med `query_nutrition`, så
			// chatten ikke kan lede med et annet «forbrent» enn skjermen.
			loadEnergyContext(userId, today, HISTORY_DAYS),
			// Kumulative kurver og sulthistorikken. Samme loader som sultendepunktet og
			// nudgen, så de tre er enige om gapet.
			loadIntradayEnergy(userId),
			listHunger(userId)
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

	const intakeByDate: Record<string, number> = {};
	for (const day of groupByDay(entries)) {
		intakeByDate[day.date] = Math.round(summarizeDay(day.date, day.entries, targets).totals.kcal);
	}

	return {
		themeName: theme.name,
		themeEmoji: theme.emoji,
		foodThemeId: foodTheme?.id ?? null,
		foodThemeName: foodTheme?.name ?? null,
		weight,
		targets,
		/** Siste vektmåling — til proteinforslaget i målkortet (1,6–2,0 g/kg). */
		latestWeightKg: energy.latestWeightKg,
		today: todaySummary,
		/** Mot makromålene, i gram. */
		macroTargets: evaluateMacroTargets({ totals: todaySummary.totals, targets }),
		/** Hvor langt på dagen inntaket ligger — der sultkriser forklares. */
		pacing: describeIntakePacing({
			kcalSoFar: todaySummary.totals.kcal,
			proteinSoFar: todaySummary.totals.proteinG,
			targetKcal: targets.kcal,
			targetProteinG: targets.proteinG,
			osloHour: osloHourNow()
		}),
		/**
		 * Hva «forbrent» består av. Ett tall kan ikke etterprøves, og 3. august ga
		 * Withings komponenter som ikke summerte til sin egen total.
		 */
		expenditureBreakdown: energy.breakdown,
		/**
		 * Vårt eget forbruksestimat, uavhengig av Withings. Null når kroppsprofilen
		 * mangler — vi gjetter ikke på høyde eller alder.
		 */
		ownExpenditure: energy.ownToday,
		/** Withings' tall, nå som kryssjekk framfor hovedkilde. */
		withingsExpenditureKcal: energy.withingsTodayKcal,
		/** Hva som mangler for å kunne regne selv. Tom liste = alt på plass. */
		ownExpenditureMissing: energy.missingForOwn,
		/**
		 * Vekta som dommer over regnestykket. Et underskudd som ikke gir vektnedgang
		 * er feil, uansett hvor pent det er satt opp — og feilen kan ligge på begge
		 * sider. Se weight-reality-check.
		 */
		realityCheck: checkAgainstWeight({
			balances: buildDailyBalances({
				entries,
				targets,
				expenditureByDate: energy.withingsExpenditureByDate,
				today
			}),
			weights: energy.weightPoints
		}),
		/**
		 * Spist mot forbrent. **Vårt eget anslag er hovedtallet** når profilen holder:
		 * det er gjennomsiktig, det gjelder hele døgnet, og det lener seg ikke på et
		 * `calories`-felt som har vist seg upålitelig. Withings blir kryssjekken.
		 *
		 * Kilden velges i `loadEnergyContext`, delt med `query_nutrition` — chatten
		 * leste Withings alene her fram til august 2026 og motsa dermed skjermen.
		 */
		energyBalance: computeEnergyBalance({
			intakeKcal: todaySummary.totals.kcal,
			expenditureKcal: energy.todayExpenditureKcal,
			// Dagen er ikke omme før midnatt Oslo-tid, så begge tallene er delvise.
			partialDay: true
		}),
		composition: energy.composition,
		compositionDate: energy.compositionDate,
		compositionChange: energy.compositionChange,
		/**
		 * Måltider som gjentas, til ett-trykks-logging. Utledet av loggen framfor
		 * lagret som favoritter — se repeat-meals for hvorfor.
		 */
		repeatable: repeatableMeals(entries),
		/** Siste 14 dager, nyeste først. Mater både historikken og snittet. */
		recent: entries,
		average: averagePerLoggedDay(entries),
		/**
		 * Inn, ut og vekt per dag. Ikke én overlay med to akser — se
		 * `history-series` for hvorfor skalavalget der ville avgjort fortellingen.
		 */
		history: buildHistorySeries({
			endDate: today,
			days: HISTORY_DAYS,
			intakeByDate,
			expenditureByDate: energy.expenditureByDate,
			weightByDate: energy.weightByDate,
			partialDate: today
		}),
		/** Hvilken av de to forbrukskildene søylene viser. */
		expenditureSource: energy.source,
		/**
		 * Kumulative kurver for i dag. Null uten kroppsprofil — uten hvilestoffskifte
		 * finnes ingen forbrukskurve å tegne.
		 */
		intraday,
		/**
		 * Sultmodellen: hvilket gap brukeren pleier å bli skikkelig sulten på, målt fra
		 * egne meldinger. Ikke en fysiologisk påstand — se `hunger.ts`.
		 */
		hungerPrediction: predictHunger({
			history: hungerHistory,
			gapNowKcal: intraday?.gapNow ?? null
		})
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
