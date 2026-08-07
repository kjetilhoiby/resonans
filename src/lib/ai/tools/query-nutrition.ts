/**
 * Leseverktøy for ernæringsloggen.
 *
 * `log_nutrition` har kunnet **skrive** til loggen siden den ble bygget, men
 * ingenting kunne lese den — så på «ser du hva jeg har spist i dag?» svarte
 * modellen ærlig «jeg har ikke tilgang», mens tallene lå rett bak i samme base.
 *
 * `query_food` dekker måltider, ukemeny og lager. Dette dekker *inntaket*: hva som
 * faktisk er spist, hva som er igjen av dagen, og hva forbruket sier. De to er med
 * vilje delt — for «er dritsulten kl. 15» trenger modellen begge, og den skal se
 * hvilket tall som kommer fra hvor.
 */

import { z } from 'zod';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import {
	averagePerLoggedDay,
	groupByDay,
	groupBySlot,
	osloDateKey,
	osloTimeLabel,
	remainingForDay,
	summarizeDay
} from '$lib/domain/nutrition/day-summary';
import { mealSlotForTime, mealSlotMeta } from '$lib/domain/nutrition/meal-slots';
import { evaluateMacroTargets } from '$lib/domain/nutrition/macro-targets';
import { describeIntakePacing, osloHourNow } from '$lib/domain/nutrition/intake-pacing';
import { computeEnergyBalance } from '$lib/domain/nutrition/energy-balance';
import { HISTORY_DAYS, loadEnergyContext } from '$lib/server/nutrition/energy-context';
import { buildDailyBalances } from '$lib/domain/nutrition/daily-balances';
import { checkAgainstWeight } from '$lib/domain/nutrition/weight-reality-check';
import { loadIntradayEnergy } from '$lib/server/nutrition/intraday';
import { listHunger } from '$lib/server/nutrition/hunger-log';
import { predictHunger } from '$lib/domain/nutrition/hunger';

export const queryNutritionTool = {
	name: 'query_nutrition',
	description: `Les brukerens ernæringslogg — hva som faktisk er spist, ikke oppskrifter eller lager (det er query_food).

Bruk denne FØR du gir råd om mat, sult eller kaloribudsjett. Uten den gjetter du på tall som finnes.

queryType:
- 'today': dagens logg gruppert i frokost/lunsj/middag/kvelds/snacks, summer, mål, hva som er igjen, forbruket med kilde og komponenter, og vektkontrollen. Inkluderer hvilken måltidsslot klokka er i nå.
- 'recent': siste N dager (default 7) med kcal, protein OG forbruk per dag, **måltidene med navn og klokkeslett**, snitt per logget dag, og vektkontrollen. Bruk denne på «hva spiste jeg i går» og «går inntaket opp eller ned mot forbruket».

Om tallene: kcal og protein er anslag mot en norsk referansetabell, med en confidence per rad. «Forbrent» er hvileforbrenning + aktivitet og vokser fram til midnatt — så et underskudd midt på dagen er strengere enn det blir om kvelden. Si det hvis du bruker tallet.

**Forbruket har en kilde, og den skal du kunne oppgi.** expenditure.source er 'own' når vi regner selv (Mifflin-St Jeor x kontorfaktor + øktene) og 'withings' ellers. Dette er samme tall og samme kilde som Ernæring-flaten leder med — sier du noe annet enn skjermen, er én av dere feil. Spør brukeren «hvorfor mener du at jeg har forbrent 2 700?», er svaret i expenditure: kilde, vårt anslag, Withings' tall, og withingsBreakdown med hvile/aktivitet. missingForOwn sier hva som mangler i kroppsprofilen når vi ikke kan regne selv — det er en konfigurasjonsmangel brukeren kan fikse i /settings/profile, ikke en datamangel. withingsBreakdown.activityFieldSuspect betyr at Withings' calories-felt spriker fra øktenes egne tall; si det framfor å bruke feltet som fasit.

**realityCheck er vekta som dommer over regnestykket.** Et underskudd som ikke gir vektnedgang er feil, og feilen kan ligge på begge sider — forbruket for høyt ELLER inntaket underlogget. Ikke velg side uten grunn. conclusive: false betyr at de loggede dagene ikke dekker nok av vinduet: da skal du si at grunnlaget er for tynt, ikke rapportere avviket som et funn. impliedDailyErrorKcal positivt = det reelle inntaket var høyere enn logget, eller forbruket lavere.

macroTargets gir avviket fra makromålene i GRAM, som er det et forslag kan handle på. pacing sier hvor langt på dagen inntaket ligger — det er der sultkriser forklares.

På «jeg er dritsulten» eller «trenger en snack»: bruk queryType today og les 'hunger' og 'cumulativeSoFar' sammen. cumulativeSoFar.gapKcal er forbrent minus spist SÅ LANGT — det eneste gap-tallet som er sammenlignbart med brukerens egen terskel (hunger.thresholdKcal, målt fra deres egne 1–5-meldinger). Ligger gapet nær eller over terskelen, si det med tallene: «du ligger på X kcal gap, og der har du meldt sterk sult N ganger før». Er hunger.ready false, si at skalaen trenger flere svar framfor å gjette — og bruk pacing i mellomtiden.

Si ALDRI noe om blodsukker. Appen måler det ikke.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['today', 'recent']).describe('today = dagens logg og budsjett, recent = historikk'),
		days: z.number().optional().describe('Antall dager for recent (default 7, maks 30)')
	}),

	execute: async (args: { userId: string; queryType: 'today' | 'recent'; days?: number }) => {
		const { userId, queryType } = args;

		if (queryType === 'recent') {
			const days = Math.min(30, Math.max(1, args.days ?? 7));
			const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
			const today = osloDateKey(new Date());
			const [entries, targets, energy] = await Promise.all([
				listIntake(userId, { since }),
				loadNutritionTargets(userId),
				// Samme kontekst flaten bruker, så inn og ut kan stilles opp mot hverandre.
				// Uten forbruket per dag kunne «går inntaket opp eller ned mot forbruket?»
				// ikke besvares i det hele tatt.
				loadEnergyContext(userId, today, days)
			]);

			return {
				days,
				/** Hvilken forbrukskilde tallene under kommer fra. Aldri blandet. */
				expenditureSource: energy.source,
				byDay: groupByDay(entries).map((day) => {
					const summary = summarizeDay(day.date, day.entries, targets);
					const expenditureKcal = energy.expenditureByDate[day.date] ?? null;
					return {
						date: day.date,
						kcal: Math.round(summary.totals.kcal),
						proteinG: Math.round(summary.totals.proteinG),
						/** Null betyr at dagen ikke har forbrukstall — ikke at forbruket var 0. */
						expenditureKcal: expenditureKcal === null ? null : Math.round(expenditureKcal),
						meals: day.entries.length,
						/**
						 * Hva som ble spist, ikke bare hvor mye. «Hva spiste jeg i går?»
						 * kunne før bare besvares med «1 910 kcal over tre måltider» —
						 * summen, aldri maten. Klokkeslettet er med fordi et råd om
						 * pacing trenger å vite når på dagen det ble spist.
						 */
						entries: summary.entries.map((entry) => ({
							time: osloTimeLabel(entry.timestamp),
							label: entry.label,
							kcal: Math.round(entry.macros.kcal),
							proteinG: Math.round(entry.macros.proteinG),
							slot: entry.mealSlot
						}))
					};
				}),
				averagePerLoggedDay: averagePerLoggedDay(entries),
				targets,
				/**
				 * Vekta som dommer over regnestykket over. Et underskudd som ikke gir
				 * vektnedgang er feil, og feilen kan ligge på begge sider — forbruket for
				 * høyt eller inntaket underlogget.
				 */
				realityCheck: checkAgainstWeight({
					balances: buildDailyBalances({
						entries,
						targets,
						expenditureByDate: energy.withingsExpenditureByDate,
						today
					}),
					weights: energy.weightPoints
				})
			};
		}

		const today = osloDateKey(new Date());
		/**
		 * Hele historikkvinduet, ikke bare i dag og i går. Vektkontrollen under måler
		 * balansen over fjorten dager, og en to-dagers logg ville aldri nådd
		 * dekningskravet — den ville sagt «ikke nok data» på en bruker som logger hver dag.
		 */
		const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
		const [entries, targets, energy, intraday, hungerHistory] = await Promise.all([
			listIntake(userId, { since }),
			loadNutritionTargets(userId),
			// Forbruket OG kilden. Fram til august 2026 leste verktøyet Withings alene
			// gjennom `loadTodayExpenditure`, mens flaten ledet med vårt eget anslag —
			// to plausible tall for «forbrent» på samme dag.
			loadEnergyContext(userId, today, HISTORY_DAYS),
			loadIntradayEnergy(userId),
			listHunger(userId)
		]);
		const expenditureKcal = energy.todayExpenditureKcal;
		const hungerPrediction = predictHunger({
			history: hungerHistory,
			gapNowKcal: intraday?.gapNow ?? null
		});

		const todayEntries = entries.filter((entry) => osloDateKey(entry.timestamp) === today);
		const summary = summarizeDay(today, todayEntries, targets);
		const nowSlot = mealSlotForTime(new Date());

		return {
			date: today,
			// Hvilken slot klokka er i nå, så råd om «neste måltid» treffer.
			currentMealSlot: nowSlot ? { id: nowSlot, label: mealSlotMeta(nowSlot).label } : null,
			totals: {
				kcal: Math.round(summary.totals.kcal),
				proteinG: Math.round(summary.totals.proteinG),
				carbsG: Math.round(summary.totals.carbsG),
				fatG: Math.round(summary.totals.fatG)
			},
			targets,
			/** Mot makromålene, i gram — det er gram et forslag kan handle på. */
			macroTargets: evaluateMacroTargets({ totals: summary.totals, targets }),
			/**
			 * Hvor langt på dagen inntaket ligger. Sultkriser kommer av dette:
			 * 3. august sto loggen på 304 kcal kl. 15, på en dag som endte over 3 000.
			 */
			pacing: describeIntakePacing({
				kcalSoFar: summary.totals.kcal,
				proteinSoFar: summary.totals.proteinG,
				targetKcal: targets.kcal,
				targetProteinG: targets.proteinG,
				osloHour: osloHourNow()
			}),
			/**
			 * Kumulativt gap **så langt**, i motsetning til `energyBalance` under, som
			 * trekker et inntak-så-langt fra et døgnanslag. Det er dette tallet et sultråd
			 * skal bruke: det er sammenlignbart med brukerens egen sultterskel.
			 */
			cumulativeSoFar: intraday
				? {
						intakeKcal: intraday.intakeNow,
						expenditureKcal: intraday.expenditureNow,
						gapKcal: intraday.gapNow,
						expenditureFullDayKcal: intraday.expenditureFullDay,
						note: 'Forbruket er modellert: hvile jevnt over døgnet, kontorpåslag over våken tid, øktene der de skjedde.'
					}
				: null,
			/**
			 * Brukerens **egen** sultterskel, målt fra sultskalaen. Dette er sterkere enn
			 * pacing i et sultråd, fordi det er målt på denne kroppen. Si aldri noe om
			 * blodsukker — vi måler det ikke.
			 */
			hunger: {
				...hungerPrediction,
				recentReports: hungerHistory.slice(0, 8).map((obs) => ({
					at: obs.at,
					level: obs.level,
					gapKcal: obs.gapKcal,
					osloHour: obs.osloHour
				}))
			},
			remaining: remainingForDay({ totals: summary.totals, targets, expenditureKcal }),
			energyBalance: computeEnergyBalance({
				intakeKcal: summary.totals.kcal,
				expenditureKcal,
				partialDay: true
			}),
			/**
			 * Hvor «forbrent» kommer fra, og hva det består av. Brukeren spurte «hvorfor
			 * mener den at jeg har forbrent 2,7k?», og det spørsmålet kunne chatten ikke
			 * svare på: den hadde ett tall uten komponenter.
			 *
			 * `source: 'own'` betyr vårt eget anslag (Mifflin-St Jeor × kontorfaktor +
			 * øktene med MET − 1), som er tallet flaten leder med. Withings er kryssjekk.
			 */
			expenditure: {
				totalKcal: expenditureKcal,
				source: energy.source,
				ownKcal: energy.ownToday?.totalKcal ?? null,
				withingsKcal: energy.withingsTodayKcal,
				/** Hva som mangler for at vi kan regne selv. Tom liste = alt på plass. */
				missingForOwn: energy.missingForOwn,
				/**
				 * Withings' egen splitt. `activityFieldSuspect` betyr at `calories`-feltet
				 * spriker fra øktenes egne tall — si det framfor å bruke det som fasit.
				 */
				withingsBreakdown: energy.breakdown,
				note: 'Forbruket vokser fram til midnatt. Et underskudd midt på dagen er strengere enn det blir om kvelden.'
			},
			/**
			 * Vekta som dommer over energibalansen. Går regnestykket ikke opp mot målt
			 * vektendring, er noe feil — og feilen kan ligge på begge sider. Krever at de
			 * loggede dagene dekker nok av vinduet; `conclusive` sier om den holder.
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
			bySlot: groupBySlot(todayEntries).map((group) => ({
				slot: group.slot ? mealSlotMeta(group.slot).label : 'uten måltid',
				kcal: Math.round(group.totals.kcal),
				proteinG: Math.round(group.totals.proteinG),
				entries: group.entries.map((entry) => ({
					time: osloTimeLabel(entry.timestamp),
					label: entry.label,
					kcal: Math.round(entry.macros.kcal),
					proteinG: Math.round(entry.macros.proteinG),
					confidence: entry.confidence
				}))
			})),
			mealsLogged: todayEntries.length,
			note:
				todayEntries.length === 0
					? 'Ingenting logget i dag ennå. Ikke anta at brukeren ikke har spist — spør.'
					: null
		};
	}
};
