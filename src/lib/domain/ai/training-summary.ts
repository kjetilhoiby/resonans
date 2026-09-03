/**
 * Trenings-dashboardet oversatt til noe en modell kan svare ut fra.
 *
 * ## Hvorfor denne finnes
 *
 * Oversikt-fanen viste «426 av 232–278», «Belastningsbalanse −14, Sliten» og
 * «Balanse 36/100» mens chatten i fanen ved siden av svarte «10 treningsøkter,
 * 94,2 km» på «ser du belastning denne uka?». Ikke fordi modellen fant på noe,
 * men fordi det eneste treningsverktøyet den hadde var `query_sensor_data` —
 * rå ukesaggregater. Hele det beregnede laget (ukesbånd, prognose, CTL/ATL/TSB,
 * disiplinbalanse, pulsfall, VO2max) fantes bare i `loadTrainingDashboardData`
 * og i Svelte-komponentene over den.
 *
 * ## Hvorfor et sammendrag, ikke payloaden
 *
 * `loadTrainingDashboardData` returnerer opptil 2000 aktiviteter og 100 rå
 * sensorhendelser med jsonb. Det er riktig for en flate som tegner grafer, og
 * feil for et verktøysvar: konteksten fylles med rader modellen ikke leser, og
 * det viktige tallet drukner. Derfor er hver `queryType` her et smalt utsnitt.
 *
 * ## Hvorfor TSB regnes her
 *
 * `computeTrainingLoad` ble fram til nå bare kalt fra `TrainingDashboard.svelte`.
 * Sender vi `dailyEffort` rått til modellen, må den regne eksponentielle snitt
 * selv — altså gjette. Regnestykket hører på vår side av grensa, og
 * `classifyTsb` er delt med kortet så ordene blir de samme.
 */

import { classifyTsb, computeTrainingLoad, type TsbStatus } from '$lib/util/training-load';
// Samme ord som flaten. To formuleringer av samme dom er verre enn én.
import { describeAcuteChronic, describeBudgetStanding } from '$lib/domain/health/effort-standing';
import {
	buildCycleSeries,
	compareCurrentToPrevious,
	describeCycleComparison,
	type CycleKind
} from '$lib/domain/health/cycle-series';

/* ── Input: bare det sammendraget faktisk leser ──────────────────────────── */

export interface TrainingSummaryInput {
	plan: { name: string; startDate: string; durationWeeks: number } | null;
	dailyEffort: Array<{ date: string; effort: number }>;
	/**
	 * Løpte kilometer per dag, hele historikken. Grunnlaget for `volume`.
	 *
	 * Valgfri fordi eldre kallsteder og tester ikke har den; mangler den, sier
	 * sammendraget det framfor å svare 0 km.
	 */
	runningHistory?: { days: Array<{ date: string; value: number }>; today: string } | null;
	vo2max: {
		best: number;
		latest: number;
		source: string;
		confidence: number;
		samples: number;
		bestAt: string;
		sourceDistance?: string;
	} | null;
	hrRecovery: {
		best: number;
		latest: number;
		band: string;
		samples: number;
		bestAt: string;
		bestEndBpm: number;
		bestPeakBpm: number;
		wellAnchored: boolean;
		sportFamily?: string;
	} | null;
	states: {
		todaySuggestion?: { kind: string; name: string; notes?: string } | null;
		restReason?: string | null;
		todayCompleted?: { name: string; kind: string } | null;
		budget?: {
			bandMin: number;
			bandMax: number;
			spentThisWeek: number;
			remainingMin: number;
			remainingMax: number;
			acuteChronicRatio: number | null;
			restRecommended: boolean;
			deload: boolean;
			anchor: string;
			maintenance: boolean;
			/** Sykdom i uka. Valgfri, siden eldre kallsteder ikke setter den. */
			sick?: boolean;
		} | null;
		balance?: {
			disciplines: Array<{ family: string; effort: number; sessions: number; pct: number }>;
			totalEffort: number;
			strengthSessionsThisWeek: number;
			runSessionsThisWeek: number;
			intensity: { rolig: number; moderat: number; hard: number } | null;
			score: number;
			nudge: { kind: string; message: string; severity: string } | null;
		} | null;
		projection?: { expectedRemaining: number; projectedTotal: number; remainingDays: number } | null;
		weekRecipe?: { label: string; totalEffort: number; sessions: string[] } | null;
		weightThreshold?: { thresholdEffort: number } | null;
		weekSessions?: Array<{ date: string; family: string; effort: number }> | null;
		endurance?: {
			week: { weekTargetKm: number; runKm: number; remainingKm: number; deload: boolean };
			forventetPaceSekPerKm: number;
			sistePaceSekPerKm: number | null;
			lengsteLopKmSiste6Uker: number;
		} | null;
		strength?: {
			armhevinger: { siste: number | null; forventet: number; nesteTarget: number; stall: boolean };
			planke: { sisteSek: number | null; forventetSek: number; nesteTargetSek: number; stall: boolean };
		} | null;
		recentEnduranceWorkouts?: Array<{
			date: string;
			family: string;
			effortScore: number | null;
			distanceMeters: number | null;
			durationSeconds: number | null;
		}> | null;
	} | null;
	milestones: Array<{ name: string; achievedAt: string | null }>;
	/**
	 * Slepende volum og sonesammensetning, fra `loadVolumeAndQuality`.
	 *
	 * `null` når lasteren feilet — flaten degraderer da også, og modellen skal si
	 * hva som mangler framfor å påstå at den ikke har tilgang.
	 */
	volumeQuality?: {
		today: string;
		zoneCoverage: { sessions: number; withZones: number; share: number };
		volume: Record<
			number,
			{
				windowDays: number;
				series: { current: number | null };
				band: { lower: number; upper: number; median: number; samples: number } | null;
				ramp: { previous: number; pctChange: number; steep: boolean } | null;
				level: { standing: string; reference: string; deltaKm: number; pctOfGoal?: number } | null;
				text: string;
			}
		>;
		quality: Record<
			number,
			{
				composition: {
					windowDays: number;
					buckets: Array<{
						character: string;
						sessions: number;
						km: number;
						sessionShare: number;
						kmShare: number;
					}>;
					totalSessions: number;
					classifiedSessions: number;
					coverage: number;
				};
				text: string;
			}
		>;
		/**
		 * Rolige minutter, kvalitetsminutter og grått per uke.
		 *
		 * Ligger ved siden av `quality` fordi de svarer på samme spørsmål i to
		 * former, og minuttene er den presise: en bøtte per økt tvinger en
		 * terskel, en mengde gjør det ikke.
		 */
		intensity: {
			weeks: Array<{
				weekStart: string;
				easyMinutes: number;
				greyMinutes: number;
				qualityMinutes: number;
				totalMinutes: number;
				sessions: number;
			}>;
			totals: {
				easyMinutes: number;
				greyMinutes: number;
				qualityMinutes: number;
				totalMinutes: number;
				weeks: number;
				activeWeeks: number;
				qualityPerActiveWeek: number | null;
			};
			text: string;
			coverage: { sessions: number; withSplit: number; share: number; staleBaseline: number };
		} | null;
	} | null;
}

export type TrainingQueryType =
	| 'load'
	| 'balance'
	| 'capacity'
	| 'sessions'
	| 'plan'
	| 'volume'
	| 'trailing'
	| 'quality';

/** Hvor mange dager tilbake CTL sammenlignes med for å si om formen stiger. */
export const CTL_TREND_DAYS = 14;

/** Økter i `sessions` — nok til å se en uke, ikke nok til å fylle konteksten. */
export const MAX_RECENT_SESSIONS = 12;

/* ── Delformer ───────────────────────────────────────────────────────────── */

export interface LoadSummary {
	/** Null når serien er tom — da er det ingen belastning å tolke. */
	ctl: number | null;
	atl: number | null;
	tsb: number | null;
	status: TsbStatus;
	/** CTL nå minus CTL for 14 dager siden. Positiv = formen bygger seg opp. */
	ctlChange: number | null;
	ctlChangeDays: number;
	/** Dager serien dekker. Under ~42 har CTL ikke svingt inn ennå. */
	seriesDays: number;
	ctlSettled: boolean;
}

export interface WeekSummary {
	spentEffort: number;
	bandMin: number;
	bandMax: number;
	/** «under» = under bandMin, «over» = over bandMax. */
	standing: 'under' | 'i_band' | 'over';
	/**
	 * Ferdig formulert dom over budsjettet, ordrett den samme flaten viser.
	 *
	 * Med bare `standing` fant modellen sine egne ord, og «over» ble like gjerne
	 * «du har overtrent» som «du gjorde mer enn planen ba om». De to er ikke det
	 * samme, og bare den andre er sann.
	 */
	planText: string;
	/** Dommen over akutt/kronisk — det eneste restitusjonssignalet. Null uten nok historikk. */
	loadText: string | null;
	loadLevel: 'rolig' | 'normal' | 'høy' | null;
	remainingMin: number;
	remainingMax: number;
	projectedTotal: number | null;
	expectedRemaining: number | null;
	remainingDays: number | null;
	/** Sann når prognosen lander under båndet — det er da et råd har effekt. */
	projectionBelowBand: boolean | null;
	acuteChronicRatio: number | null;
	restRecommended: boolean;
	deload: boolean;
	maintenance: boolean;
	/** Uka er en sykeuke: rammen er senket, og «under planen» gjelder ikke. */
	sick: boolean;
	anchor: string;
	weightThresholdEffort: number | null;
	runKm: number | null;
	weekTargetKm: number | null;
	remainingKm: number | null;
	sessions: Array<{ date: string; family: string; effort: number }>;
	recipe: { label: string; totalEffort: number; sessions: string[] } | null;
}

/* ── Sammendraget ────────────────────────────────────────────────────────── */

/**
 * Én deklarert form med valgfrie seksjoner, framfor en union per `queryType`.
 *
 * Formen på JSON-en er den samme — `JSON.stringify` dropper `undefined` — men
 * kallstedet slipper å smalne typen med en `queryType`-sjekk før det kan lese
 * `summary.week`. Seksjonstypene hentes fra hjelpefunksjonene, så de kan ikke
 * drive fra hva som faktisk returneres.
 */
export interface TrainingSummary {
	queryType: TrainingQueryType;
	hasPlan: boolean;
	note?: string;
	week?: WeekSummary | null;
	load?: LoadSummary;
	balance?: ReturnType<typeof summarizeBalance>;
	capacity?: ReturnType<typeof summarizeCapacity>;
	sessions?: ReturnType<typeof summarizeSessions>;
	plan?: ReturnType<typeof summarizePlan>;
	volume?: ReturnType<typeof summarizeVolume>;
	trailing?: ReturnType<typeof summarizeTrailing>;
	quality?: ReturnType<typeof summarizeQuality>;
}

/**
 * Slepende volum: summen av de siste 7/30/90 dagene, med bånd og rampe.
 *
 * **Et annet spørsmål enn `summarizeVolume`.** Den svarer på «hvor mye har jeg
 * løpt i år» og nullstilles 1. januar; denne svarer på «hvor mye løper jeg NÅ», og
 * kan leses av hver dag i året. Begge finnes fordi brukeren stiller begge.
 */
export function summarizeTrailing(input: TrainingSummaryInput) {
	const vq = input.volumeQuality;
	if (!vq) {
		return { available: false as const, note: 'Slepende volum kunne ikke hentes.' };
	}

	const windows = Object.values(vq.volume).map((view) => ({
		windowDays: view.windowDays,
		km: view.series.current,
		// Båndet er brukerens EGNE kvartiler for samme tid på året, av tidligere år.
		band: view.band,
		ramp: view.ramp,
		level: view.level,
		// Setningen bærer forbeholdene — hva sammenligningen ble gjort mot, og at
		// en bratt rampe ikke er en dom om kroppen. Skal siteres, ikke omskrives.
		sentence: view.text
	}));

	return {
		available: true as const,
		today: vq.today,
		windows
	};
}

/**
 * Sammensetning: andel rolige, grå og harde ØKTER.
 *
 * **Økter, ikke minutter, og det er hele poenget.** Hver hard økt bærer
 * oppvarming, pauser og nedjogg i de lave sonene, så minuttfordelingen viser
 * «mest rolig» både for en polarisert og en helt grå måned. Se
 * `session-character.ts`.
 */
export function summarizeQuality(input: TrainingSummaryInput) {
	const vq = input.volumeQuality;
	if (!vq) {
		return { available: false as const, note: 'Sonesammensetning kunne ikke hentes.' };
	}

	const windows = Object.values(vq.quality).map((view) => ({
		windowDays: view.composition.windowDays,
		buckets: view.composition.buckets,
		totalSessions: view.composition.totalSessions,
		classifiedSessions: view.composition.classifiedSessions,
		coverage: Math.round(view.composition.coverage * 100) / 100,
		sentence: view.text
	}));

	return {
		available: true as const,
		today: vq.today,
		// Dekningen på toppnivå fordi den avgjør om tallene i det hele tatt kan
		// brukes. En fordeling bygget på fire av tolv økter ser like autoritativ ut
		// som en bygget på alle tolv.
		zoneCoverage: vq.zoneCoverage,
		windows,
		// **Minuttene er hovedsvaret, bøttene er bakgrunnen.** Uken-for-uken-tallene
		// tvinger ingen terskel: «for mye i midten» er et tall som skal ned, ikke
		// en etikett en økt får. Se `weekly-intensity.ts`.
		weeklyMinutes: vq.intensity
			? {
					weeks: vq.intensity.weeks,
					totals: vq.intensity.totals,
					sentence: vq.intensity.text,
					coverage: vq.intensity.coverage
				}
			: null
	};
}

/**
 * Akkumulert løping, år mot år og måned mot måned — de samme tallene
 * `RunningCumulativeCard` viser.
 *
 * Sammenligningen er gjort på SAMME dag i perioden, aldri mot fjorårets
 * sluttall: «380 km bak 2025» er sant hver vår og betyr ingenting. Motoren er
 * delt med flaten (`compareCurrentToPrevious`), så chatten og skjermen ikke kan
 * si to ulike tall om samme uke.
 */
export function summarizeVolume(input: TrainingSummaryInput) {
	const history = input.runningHistory;
	if (!history || history.days.length === 0) {
		return { available: false as const, note: 'Ingen registrerte løpeturer å summere.' };
	}

	function view(cycle: CycleKind, previousNoun: string) {
		const series = buildCycleSeries(history!.days, {
			cycle,
			mode: 'cumulative',
			today: history!.today,
			maxSeries: cycle === 'year' ? 8 : 12
		});
		const comparison = compareCurrentToPrevious(series);
		const current = series.find((s) => s.isCurrent) ?? null;
		return {
			totalKm: current?.last ? Math.round(current.last.value) : 0,
			daysWithRun: current?.points.length ?? 0,
			atIndex: comparison?.index ?? null,
			previous: comparison?.previous
				? { label: comparison.previous.label, km: Math.round(comparison.previous.value) }
				: null,
			averageBefore:
				comparison?.averageBefore !== null && comparison?.averageBefore !== undefined
					? Math.round(comparison.averageBefore)
					: null,
			periodsCompared: comparison?.periodsCompared ?? 0,
			sentence: describeCycleComparison(comparison, {
				unit: 'km',
				higherIsBetter: true,
				previousNoun
			}),
			/** Hele periodens sluttall, for hver tidligere periode. */
			completed: series
				.filter((s) => !s.isCurrent)
				.map((s) => ({ label: s.label, km: Math.round(s.last?.value ?? 0) }))
		};
	}

	return {
		available: true as const,
		year: view('year', 'i fjor'),
		month: view('month', 'forrige måned')
	};
}

export function summarizeTrainingForChat(
	input: TrainingSummaryInput,
	queryType: TrainingQueryType = 'load'
): TrainingSummary {
	const base = {
		queryType,
		hasPlan: input.plan !== null,
		/**
		 * Uten treningsløp finnes verken ukesbånd eller balanse — bare belastningsserien.
		 * Modellen skal si det framfor å påstå at tallene mangler.
		 */
		note:
			input.plan === null
				? 'Ingen aktivt treningsløp. Belastning (CTL/ATL/TSB) og kapasitet finnes likevel; ukesbånd, balanse og øktforslag krever et løp.'
				: undefined
	};

	if (queryType === 'capacity') {
		return { ...base, capacity: summarizeCapacity(input) };
	}

	if (queryType === 'balance') {
		return { ...base, balance: summarizeBalance(input) };
	}

	if (queryType === 'sessions') {
		return { ...base, sessions: summarizeSessions(input) };
	}

	if (queryType === 'plan') {
		return { ...base, plan: summarizePlan(input) };
	}

	if (queryType === 'volume') {
		return { ...base, volume: summarizeVolume(input) };
	}

	if (queryType === 'trailing') {
		return { ...base, trailing: summarizeTrailing(input) };
	}

	if (queryType === 'quality') {
		return { ...base, quality: summarizeQuality(input) };
	}

	// 'load' — standardsvaret: uka mot båndet, og belastningen bak den.
	return {
		...base,
		week: summarizeWeek(input),
		load: summarizeLoad(input.dailyEffort)
	};
}

export function summarizeLoad(series: Array<{ date: string; effort: number }>): LoadSummary {
	const points = computeTrainingLoad(series);
	const latest = points.at(-1) ?? null;

	if (!latest) {
		return {
			ctl: null,
			atl: null,
			tsb: null,
			status: classifyTsb(null),
			ctlChange: null,
			ctlChangeDays: CTL_TREND_DAYS,
			seriesDays: 0,
			ctlSettled: false
		};
	}

	/**
	 * Referansepunktet plukkes på indeks, ikke på dato. `computeTrainingLoad`
	 * fyller hull med 0 før den regner, så serien er sammenhengende dag for dag —
	 * indeks −14 ER for fjorten dager siden.
	 */
	const earlier = points.length > CTL_TREND_DAYS ? points[points.length - 1 - CTL_TREND_DAYS] : null;

	return {
		ctl: latest.ctl,
		atl: latest.atl,
		tsb: latest.tsb,
		status: classifyTsb(latest.tsb),
		ctlChange: earlier ? Math.round((latest.ctl - earlier.ctl) * 10) / 10 : null,
		ctlChangeDays: CTL_TREND_DAYS,
		seriesDays: points.length,
		// CTL har 42-dagers tidskonstant: kortere serie er fortsatt på vei opp fra 0.
		ctlSettled: points.length >= 42
	};
}

function summarizeWeek(input: TrainingSummaryInput): WeekSummary | null {
	const budget = input.states?.budget;
	if (!budget) return null;

	const projection = input.states?.projection ?? null;
	const endurance = input.states?.endurance ?? null;

	// I en sykeuke er gulvet null, så «under planen» finnes ikke — samme
	// avgjørelse som `describeBudgetStanding` tar, og de to må være enige.
	const standing: WeekSummary['standing'] =
		!budget.sick && budget.spentThisWeek < budget.bandMin
			? 'under'
			: budget.spentThisWeek > budget.bandMax
				? 'over'
				: 'i_band';

	const plan = describeBudgetStanding(
		budget.spentThisWeek,
		budget.bandMin,
		budget.bandMax,
		budget.sick ?? false
	);
	const load = describeAcuteChronic(budget.acuteChronicRatio, budget.restRecommended);

	return {
		spentEffort: Math.round(budget.spentThisWeek),
		bandMin: budget.bandMin,
		bandMax: budget.bandMax,
		standing,
		planText: plan.text,
		loadText: load?.text ?? null,
		loadLevel: load?.level ?? null,
		sick: budget.sick ?? false,
		remainingMin: budget.remainingMin,
		remainingMax: budget.remainingMax,
		projectedTotal: projection?.projectedTotal ?? null,
		expectedRemaining: projection?.expectedRemaining ?? null,
		remainingDays: projection?.remainingDays ?? null,
		projectionBelowBand: projection ? projection.projectedTotal < budget.bandMin : null,
		acuteChronicRatio: budget.acuteChronicRatio,
		restRecommended: budget.restRecommended,
		deload: budget.deload,
		maintenance: budget.maintenance,
		anchor: budget.anchor,
		weightThresholdEffort: input.states?.weightThreshold?.thresholdEffort ?? null,
		runKm: endurance ? Math.round(endurance.week.runKm * 10) / 10 : null,
		weekTargetKm: endurance ? Math.round(endurance.week.weekTargetKm * 10) / 10 : null,
		remainingKm: endurance ? Math.round(endurance.week.remainingKm * 10) / 10 : null,
		sessions: input.states?.weekSessions ?? [],
		recipe: input.states?.weekRecipe ?? null
	};
}

function summarizeBalance(input: TrainingSummaryInput) {
	const balance = input.states?.balance;
	if (!balance) return null;

	return {
		score: balance.score,
		totalEffort: Math.round(balance.totalEffort),
		/** Sortert synkende på effort av `computeBalance` — rekkefølgen er informasjon. */
		disciplines: balance.disciplines.map((d) => ({
			family: d.family,
			pct: d.pct,
			sessions: d.sessions,
			effort: Math.round(d.effort)
		})),
		intensity: balance.intensity,
		strengthSessionsThisWeek: balance.strengthSessionsThisWeek,
		runSessionsThisWeek: balance.runSessionsThisWeek,
		/**
		 * Én nudge om gangen, det største avviket — samme setning flaten viser.
		 * `score` alene sier at noe er skjevt, aldri hva.
		 */
		nudge: balance.nudge
	};
}

function summarizeCapacity(input: TrainingSummaryInput) {
	return {
		/**
		 * VO2max: **beste** observasjon i vinduet, ikke siste. VDOT antar maksimal
		 * innsats, så en rolig 10k gir et lavt tall som bare sier at du løp rolig.
		 */
		vo2max: input.vo2max
			? {
					best: Math.round(input.vo2max.best * 10) / 10,
					latest: Math.round(input.vo2max.latest * 10) / 10,
					source: input.vo2max.source,
					sourceDistance: input.vo2max.sourceDistance,
					confidence: input.vo2max.confidence,
					samples: input.vo2max.samples,
					bestAt: input.vo2max.bestAt,
					window: 'siste åtte uker'
				}
			: null,
		/** Pulsfall: også beste, av samme grunn — et fall forutsetter at du presset. */
		hrRecovery: input.hrRecovery
			? {
					bestDropBpm: input.hrRecovery.best,
					latestDropBpm: input.hrRecovery.latest,
					band: input.hrRecovery.band,
					fromBpm: input.hrRecovery.bestPeakBpm,
					toBpm: input.hrRecovery.bestEndBpm,
					samples: input.hrRecovery.samples,
					bestAt: input.hrRecovery.bestAt,
					sportFamily: input.hrRecovery.sportFamily,
					/**
					 * Lå ankeret langt under toppen, startet fallet før målingen begynte,
					 * og tallet er et gulv. Ikke en feil, men det skal sies.
					 */
					wellAnchored: input.hrRecovery.wellAnchored,
					window: 'siste fire uker'
				}
			: null,
		missing: [
			input.vo2max ? null : 'vo2max',
			input.hrRecovery ? null : 'pulsfall'
		].filter((v): v is string => v !== null)
	};
}

function summarizeSessions(input: TrainingSummaryInput) {
	const workouts = input.states?.recentEnduranceWorkouts ?? [];
	return {
		count: workouts.length,
		workouts: workouts.slice(0, MAX_RECENT_SESSIONS).map((w) => ({
			date: w.date,
			family: w.family,
			effort: w.effortScore === null ? null : Math.round(w.effortScore),
			km: w.distanceMeters === null ? null : Math.round((w.distanceMeters / 1000) * 10) / 10,
			minutes: w.durationSeconds === null ? null : Math.round(w.durationSeconds / 60)
		})),
		truncated: workouts.length > MAX_RECENT_SESSIONS
	};
}

function summarizePlan(input: TrainingSummaryInput) {
	if (!input.plan) return null;
	const states = input.states;
	const achieved = input.milestones.filter((m) => m.achievedAt !== null);

	return {
		name: input.plan.name,
		startDate: input.plan.startDate,
		durationWeeks: input.plan.durationWeeks,
		todaySuggestion: states?.todaySuggestion
			? {
					kind: states.todaySuggestion.kind,
					name: states.todaySuggestion.name,
					notes: states.todaySuggestion.notes
				}
			: null,
		restReason: states?.restReason ?? null,
		todayCompleted: states?.todayCompleted ?? null,
		endurance: states?.endurance
			? {
					expectedPaceSecPerKm: states.endurance.forventetPaceSekPerKm,
					recentPaceSecPerKm: states.endurance.sistePaceSekPerKm,
					longestRunKmLast6Weeks: states.endurance.lengsteLopKmSiste6Uker
				}
			: null,
		strength: states?.strength
			? {
					pushups: states.strength.armhevinger,
					plank: states.strength.planke
				}
			: null,
		milestones: {
			achieved: achieved.length,
			total: input.milestones.length,
			// De sist nådde er de som er verdt å nevne; navnene alene er korte.
			recentlyAchieved: achieved
				.slice()
				.sort((a, b) => (a.achievedAt! < b.achievedAt! ? 1 : -1))
				.slice(0, 3)
				.map((m) => ({ name: m.name, achievedAt: m.achievedAt })),
			pending: input.milestones.filter((m) => m.achievedAt === null).map((m) => m.name).slice(0, 5)
		}
	};
}
