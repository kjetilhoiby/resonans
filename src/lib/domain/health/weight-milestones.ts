/**
 * Milepælene på Vekt-flaten: setninger som utnytter dybden i historikken.
 *
 * ## Regelen som gjør dem verdt å lese
 *
 * En oppmuntring som ikke er sann er verre enn ingen oppmuntring, fordi den
 * ødelegger tilliten til alle de andre tallene på flaten. Fire vakter holder
 * dem ærlige:
 *
 * 1. **Rekorder regnes på trenden, ikke på rå målinger.** En rå måling kan være
 *    en dehydrert morgen. «Laveste måling siden i fjor» er en ekte setning, men
 *    den rangeres under trenden nettopp fordi den kan skyldes væsketap.
 * 2. **En rekord må ha et spenn.** «Laveste på ni dager» er ikke en milepæl, det
 *    er en tirsdag. `MIN_RECORD_SPAN_DAYS` er terskelen.
 * 3. **Nedgang må overstige støyen** (`MEANINGFUL_DROP_KG`), og de historiske
 *    vinduene den sammenlignes med må ikke overlappe det nåværende — ellers
 *    sammenligner vi en periode med seg selv.
 * 4. **Kroppssammensetningen kan avlyse feiringen.** Ned 1,4 kg der 0,9 er
 *    muskel er ikke en seier, og setningen skal si det. Se `MUSCLE_SHARE_WARN`.
 *
 * ## Hvorfor atferdsmilepælene finnes
 *
 * En motor som bare feirer synkende vekt er stum i alle de ukene vekta stiger —
 * altså akkurat når man trenger å høre noe. `weigh-in-streak` og
 * `weigh-in-coverage` handler om noe man faktisk kontrollerer: at man veier seg.
 * De er sanne uansett retning, og de er de eneste som kan fyre hver uke.
 */

import {
	buildMetricSeries,
	dayNumber,
	daysBetween,
	type MetricPoint,
	type WeightDay
} from './weight-series';
import { describeCompositionChange, type BodyComposition } from './body-composition';
import { describeSpan, formatMilestoneDate, kg } from './weight-text';
import {
	currentSwing,
	describeCurrentSwing,
	findWeightSwings,
	isLargestInDirection,
	type WeightSwing
} from './weight-swings';

export type MilestoneKind =
	| 'lowest-trend'
	| 'current-swing'
	| 'largest-drop'
	| 'below-goal'
	| 'lowest-raw'
	| 'weigh-in-streak'
	| 'weigh-in-coverage'
	| 'goal-distance'
	| 'above-nadir'
	| 'stale';

export interface WeightMilestone {
	kind: MilestoneKind;
	/** Ferdig formulert setning. Flaten skal ikke sette sammen tall selv. */
	sentence: string;
	tone: 'positiv' | 'nøytral';
	/** Hva setningen er regnet på. Trenden er sterkest, atferd er alltid sann. */
	basis: 'trend' | 'måling' | 'atferd';
	/** Datoen setningen viser tilbake til, når den har en. */
	sinceDate?: string;
	/** Lengste strekk uten veiing inne i perioden setningen dekker. */
	longestGapDays?: number;
}

export interface WeightMilestoneResult {
	milestones: WeightMilestone[];
	/**
	 * Periodene kurven er delt i — topper og bunner, begge retninger.
	 *
	 * Returneres herfra framfor å regnes en gang til i lasteren: samme input gir
	 * samme svar, men to kallsteder er to steder å endre, og flaten og setningen
	 * skal ikke kunne komme til å vise ulike perioder.
	 */
	swings: WeightSwing[];
	/** Dager mellom første og siste veiing. */
	historyDays: number;
	weighIns: number;
	/** Sann når historikken er dyp nok til at rekorder betyr noe. */
	enoughHistory: boolean;
}

/** Rekorder krever en historikk å være rekord i. */
export const MIN_HISTORY_DAYS = 60;
export const MIN_HISTORY_WEIGH_INS = 20;

/** «Laveste siden i forrige uke» er ikke en milepæl. */
export const MIN_RECORD_SPAN_DAYS = 30;

/**
 * Hvor mye trenden må ha falt over `MIN_RECORD_SPAN_DAYS` før en rekord regnes.
 *
 * ## Hvorfor denne finnes
 *
 * Første utgave brukte `<=` når den lette etter forrige gang du var like lav, og
 * lot det stå som platå-vakt. Det slo feil i begge retninger. En ekte, jevn
 * nedgang på 0,75 kg i måneden gir en trend som — avrundet til én desimal —
 * står stille i tre-fire dager i strekk. Referansedatoen ble dermed «for tre
 * dager siden», spennet falt under terskelen, og milepælen brukeren ventet på
 * fyrte aldri.
 *
 * Vaktene er nå to uavhengige: referansen finnes med streng `<` («forrige gang
 * du var LAVERE»), og et platå stoppes av at trenden faktisk må ha falt et
 * målbart stykke den siste måneden. Avrundingslikhet påvirker ingen av dem.
 */
export const RECORD_MARGIN_KG = 0.2;

/** Under dette er en «nedgang» vektas egen usikkerhet. */
export const MEANINGFUL_DROP_KG = 0.5;

/**
 * Vinduene nedgangen måles over. Navngitte og faste, ikke søkt fram: skanner man
 * alle vinduslengder etter det største fallet, finner man alltid noe, og svaret
 * blir «største 3-dagersfall» — altså væsketap.
 */
export const DROP_WINDOWS_DAYS = [30, 90, 180, 365] as const;

/** Hvor langt fra vinduets kant en måling kan ligge og fortsatt brukes som endepunkt. */
export const WINDOW_TOLERANCE_DAYS = 3;

/** Over dette er siste veiing for gammel til at rekorder sier noe om i dag. */
export const MAX_STALE_DAYS = 10;

export const MIN_STREAK_DAYS = 7;
export const COVERAGE_WINDOW_DAYS = 30;
export const MIN_COVERAGE_DAYS = 20;

/** Er mer enn halve nedgangen muskel, er den ikke en seier. */
export const MUSCLE_SHARE_WARN = 0.5;

/** Under dette står du praktisk talt PÅ lavpunktet, og setningen er innholdsløs. */
export const NADIR_DISTANCE_FLOOR_KG = 0.3;

/**
 * Så nær lavpunktet at en pågående oppgang og «over lavpunktet» er samme setning.
 *
 * Starter oppgangen PÅ historikkens lavpunkt, sier de to bullettene det samme med
 * ulike ord — og den svakeste låner troverdighet fra den sterkeste. Samme regel som
 * `echoesTrendRecord` bruker mot rå-rekorden. Toleransen finnes fordi et platå i
 * bunnen kan flytte periodens grense en dag eller to fra lavpunktets dato.
 */
export const NADIR_ECHO_DAYS = 7;

export const MAX_MILESTONES = 3;

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Datoene, spennene og kilotallene bor i `weight-text.ts` og deles med
 * periodemodulen. Re-eksporteres her fordi testene og flatene importerer dem her.
 */
export { describeSpan, formatMilestoneDate } from './weight-text';

/** Lengste strekk uten veiing mellom to datoer. Sier hvor mye claimet ikke vet. */
export function longestGapBetween(days: WeightDay[], fromDate: string, toDate: string): number {
	const from = dayNumber(fromDate);
	const to = dayNumber(toDate);
	const inside = days.map((d) => dayNumber(d.date)).filter((d) => d >= from && d <= to);
	if (inside.length < 2) return to - from;
	let longest = 0;
	for (let i = 1; i < inside.length; i++) longest = Math.max(longest, inside[i] - inside[i - 1]);
	return longest;
}

function compositionOf(day: WeightDay): BodyComposition {
	return {
		fatMassKg: day.fatMassKg,
		fatRatio: day.fatRatio,
		muscleMassKg: day.muscleMassKg,
		fatFreeMassKg: day.fatFreeMassKg,
		boneMassKg: null,
		hydrationKg: null,
		fatMassSource: day.fatMassKg === null ? null : 'measured'
	};
}

/**
 * Kvalifiserer en nedgang med kroppssammensetningen.
 *
 * Returnerer en setning bare når muskeltapet er verdt å nevne — altså når det
 * utgjør mer enn `MUSCLE_SHARE_WARN` av vektnedgangen. Ellers null, og
 * milepælen står som den er.
 *
 * Krever muskelmåling i BEGGE ender. Å gjette den ene enden ville gjort
 * kvalifiseringen mer usikker enn påstanden den kvalifiserer.
 */
export function qualifyByMuscleLoss(
	from: WeightDay | undefined,
	to: WeightDay | undefined
): { sentence: string; muscleShare: number } | null {
	if (!from || !to) return null;
	if (from.muscleMassKg === null || to.muscleMassKg === null) return null;

	const change = describeCompositionChange(
		{ weightKg: from.weightKg, composition: compositionOf(from) },
		{ weightKg: to.weightKg, composition: compositionOf(to) }
	);
	if (!change || change.muscleMassKg === null || change.weightKg >= 0) return null;

	const muscleLoss = -change.muscleMassKg;
	if (muscleLoss <= 0) return null;
	const share = muscleLoss / -change.weightKg;
	if (share <= MUSCLE_SHARE_WARN) return null;

	return {
		sentence: `Men ${kg(muscleLoss)} av de ${kg(change.weightKg)} kiloene er muskel.`,
		muscleShare: Math.round(share * 100) / 100
	};
}

/** Trendverdien nærmest en måldag, innenfor toleransen. */
function trendNear(
	trendByDay: Map<number, number>,
	targetDay: number,
	tolerance = WINDOW_TOLERANCE_DAYS
): number | null {
	for (let offset = 0; offset <= tolerance; offset++) {
		const earlier = trendByDay.get(targetDay - offset);
		if (earlier !== undefined) return earlier;
		const later = trendByDay.get(targetDay + offset);
		if (later !== undefined) return later;
	}
	return null;
}

/**
 * Forrige gang verdien var STRENGT lavere enn nå.
 *
 * Streng `<`, ikke `<=`: med avrunding til én desimal er nabodager på en jevn
 * nedgang ofte helt like, og `<=` ville pekt på i forgårs framfor på i fjor. At
 * et platå ikke skal utløse rekorder håndteres av `hasRecentProgress`, ikke her.
 */
function lastTimeStrictlyBelow(
	points: MetricPoint[],
	valueOf: (p: MetricPoint) => number | null,
	latestIndex: number,
	value: number
): string | null {
	for (let i = latestIndex - 1; i >= 0; i--) {
		const candidate = valueOf(points[i]);
		if (candidate === null) continue;
		if (candidate < value) return points[i].date;
	}
	return null;
}

interface RecordContext {
	days: WeightDay[];
	points: MetricPoint[];
	/** Periodene kurven er delt i. Regnet én gang, lest av setningene. */
	swings: WeightSwing[];
	dayByDate: Map<string, WeightDay>;
	trendByDay: Map<number, number>;
	latestTrend: { index: number; point: MetricPoint; value: number } | null;
	firstDate: string;
	lastDate: string;
	historyDays: number;
	/**
	 * Sann når trenden har falt minst `RECORD_MARGIN_KG` den siste måneden.
	 *
	 * Platå-vakta for alle rekordene. Null når trenden for en måned siden ikke
	 * finnes — da kan vi ikke vise at noe har skjedd, og en rekord som ikke kan
	 * etterprøves skal ikke fyre.
	 */
	hasRecentProgress: boolean;
}

function lowestTrendMilestone(ctx: RecordContext): WeightMilestone | null {
	if (!ctx.latestTrend || !ctx.hasRecentProgress) return null;
	const { index, point, value } = ctx.latestTrend;
	const since = lastTimeStrictlyBelow(ctx.points, (p) => p.trend, index, value);

	if (since === null) {
		return {
			kind: 'lowest-trend',
			sentence: `Snittvekta på ${kg(value)} kg er den laveste vi har målt — ${describeSpan(ctx.historyDays)} med historikk.`,
			tone: 'positiv',
			basis: 'trend',
			longestGapDays: longestGapBetween(ctx.days, ctx.firstDate, ctx.lastDate)
		};
	}

	const span = daysBetween(since, point.date);
	if (span < MIN_RECORD_SPAN_DAYS) return null;

	return {
		kind: 'lowest-trend',
		sentence: `Snittvekta har ikke vært lavere enn ${kg(value)} kg siden ${formatMilestoneDate(since)} — ${describeSpan(span)} tilbake.`,
		tone: 'positiv',
		basis: 'trend',
		sinceDate: since,
		longestGapDays: longestGapBetween(ctx.days, since, point.date)
	};
}

function lowestRawMilestone(ctx: RecordContext): WeightMilestone | null {
	const latestIndex = ctx.points.length - 1;
	if (latestIndex < 0 || !ctx.hasRecentProgress) return null;
	const latest = ctx.points[latestIndex];
	const since = lastTimeStrictlyBelow(ctx.points, (p) => p.raw, latestIndex, latest.raw);
	if (since === null) {
		return {
			kind: 'lowest-raw',
			sentence: `${kg(latest.raw)} kg er den laveste enkeltmålingen i hele historikken.`,
			tone: 'positiv',
			basis: 'måling'
		};
	}

	const span = daysBetween(since, latest.date);
	if (span < MIN_RECORD_SPAN_DAYS) return null;

	return {
		kind: 'lowest-raw',
		sentence: `${kg(latest.raw)} kg er den laveste enkeltmålingen siden ${formatMilestoneDate(since)}.`,
		tone: 'positiv',
		basis: 'måling',
		sinceDate: since,
		longestGapDays: longestGapBetween(ctx.days, since, latest.date)
	};
}

/**
 * Største nedgang over et navngitt vindu, målt mot hele historikken.
 *
 * De historiske vinduene må slutte på eller før dagens vindu STARTER. Uten det
 * ville et vindu som overlapper dagens fyre trivielt («bratteste 90 dager siden
 * for 14 dager siden»), fordi de to periodene deler nesten alle dagene.
 */
function largestDropMilestone(ctx: RecordContext): WeightMilestone | null {
	if (!ctx.latestTrend) return null;
	const endDay = dayNumber(ctx.latestTrend.point.date);
	const latestValue = ctx.latestTrend.value;
	const firstDay = dayNumber(ctx.firstDate);

	const candidates: Array<{
		window: number;
		drop: number;
		sinceDate: string | null;
		allTime: boolean;
		startDate: string | null;
	}> = [];

	for (const window of DROP_WINDOWS_DAYS) {
		const start = trendNear(ctx.trendByDay, endDay - window);
		if (start === null) continue;
		const drop = round1(latestValue - start);
		if (drop > -MEANINGFUL_DROP_KG) continue;

		// Historiske, ikke-overlappende vinduer, nyeste først.
		let sinceDay: number | null = null;
		for (let candidateEnd = endDay - window; candidateEnd >= firstDay + window; candidateEnd--) {
			const end = ctx.trendByDay.get(candidateEnd);
			if (end === undefined) continue;
			const candidateStart = trendNear(ctx.trendByDay, candidateEnd - window);
			if (candidateStart === null) continue;
			if (round1(end - candidateStart) <= drop) {
				sinceDay = candidateEnd;
				break;
			}
		}

		candidates.push({
			window,
			drop,
			sinceDate: sinceDay === null ? null : isoFromDayNumber(sinceDay),
			allTime: sinceDay === null,
			startDate: isoFromDayNumber(endDay - window)
		});
	}

	if (candidates.length === 0) return null;

	// En rekord for hele historikken slår et langt vindu som bare er nest best:
	// «det bratteste vi har målt» er en sterkere beskjed enn «bratteste på et år».
	candidates.sort((a, b) => Number(b.allTime) - Number(a.allTime) || b.window - a.window);
	const best = candidates[0];

	const headline = `Ned ${kg(best.drop)} kg på ${best.window} dager`;
	const tail = best.allTime
		? `den bratteste ${best.window}-dagersperioden vi har målt.`
		: `den bratteste ${best.window}-dagersperioden siden ${formatMilestoneDate(best.sinceDate!)}.`;

	let sentence = `${headline} — ${tail}`;
	let tone: WeightMilestone['tone'] = 'positiv';

	const qualification = qualifyByMuscleLoss(
		nearestDay(ctx, endDay - best.window),
		ctx.dayByDate.get(ctx.latestTrend.point.date)
	);
	if (qualification) {
		sentence += ` ${qualification.sentence}`;
		tone = 'nøytral';
	}

	return {
		kind: 'largest-drop',
		sentence,
		tone,
		basis: 'trend',
		sinceDate: best.sinceDate ?? undefined,
		longestGapDays: best.startDate
			? longestGapBetween(ctx.days, best.startDate, ctx.latestTrend.point.date)
			: undefined
	};
}

function isoFromDayNumber(day: number): string {
	return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function nearestDay(ctx: RecordContext, targetDay: number): WeightDay | undefined {
	for (let offset = 0; offset <= WINDOW_TOLERANCE_DAYS; offset++) {
		const earlier = ctx.dayByDate.get(isoFromDayNumber(targetDay - offset));
		if (earlier) return earlier;
		const later = ctx.dayByDate.get(isoFromDayNumber(targetDay + offset));
		if (later) return later;
	}
	return undefined;
}

/**
 * Den pågående perioden som milepæl — kurvens egne grenser framfor et fast vindu.
 *
 * ## Hvorfor denne finnes ved siden av `largest-drop`
 *
 * Et fast vindu treffer sjelden der bevegelsen begynte. Målt i prod 23. august
 * 2026 sa 365-dagersvinduet «ned 1,8 kg på et år» om en bruker som hadde gått ned
 * nesten seks kilo siden april — sant, og likevel en dårlig beskrivelse, fordi
 * vinduet blandet inn en oppgang som lå foran nedgangen.
 *
 * Perioden bærer forbeholdene sine selv (tilbakeslag fra ytterpunktet, sluttempo
 * som avviker), så setningen kommer ferdig fra `describeCurrentSwing`.
 */
function currentSwingMilestone(ctx: RecordContext, swing: WeightSwing): WeightMilestone {
	let sentence = describeCurrentSwing(swing, {
		largestInDirection: isLargestInDirection(swing, ctx.swings)
	});
	let tone: WeightMilestone['tone'] = swing.direction === 'ned' ? 'positiv' : 'nøytral';

	// Samme kvalifisering som det faste vinduet får: er mesteparten av nedgangen
	// muskel, er den ikke en seier.
	if (swing.direction === 'ned') {
		const qualification = qualifyByMuscleLoss(
			ctx.dayByDate.get(swing.startDate) ?? nearestDay(ctx, dayNumber(swing.startDate)),
			ctx.dayByDate.get(swing.endDate) ?? nearestDay(ctx, dayNumber(swing.endDate))
		);
		if (qualification) {
			sentence += ` ${qualification.sentence}`;
			tone = 'nøytral';
		}
	}

	return {
		kind: 'current-swing',
		sentence,
		tone,
		basis: 'trend',
		sinceDate: swing.startDate,
		longestGapDays: swing.longestGapDays
	};
}

function goalMilestone(ctx: RecordContext, goalKg: number | null | undefined): WeightMilestone | null {
	if (typeof goalKg !== 'number' || !Number.isFinite(goalKg) || goalKg <= 0) return null;
	const current = ctx.latestTrend?.value ?? ctx.points.at(-1)?.raw ?? null;
	if (current === null) return null;

	const diff = round1(current - goalKg);
	if (diff <= 0) {
		return {
			kind: 'below-goal',
			// «0,0 kg under» er ikke en setning. Å stå PÅ målet er sin egen beskjed.
			sentence:
				diff === 0
					? `Du er på målvekta på ${kg(goalKg)} kg.`
					: `Du er ${kg(diff)} kg under målvekta på ${kg(goalKg)} kg.`,
			tone: 'positiv',
			basis: ctx.latestTrend ? 'trend' : 'måling'
		};
	}

	return {
		kind: 'goal-distance',
		sentence: `${kg(diff)} kg til målet på ${kg(goalKg)} kg.`,
		tone: 'nøytral',
		basis: ctx.latestTrend ? 'trend' : 'måling'
	};
}

/**
 * Veiestreak — den ene milepælen som er sann uansett hvilken vei vekta går.
 *
 * Starter i dag hvis du har veid deg, ellers i går: en morgenveiing som ikke har
 * skjedd ennå skal ikke nulle en streak på atten dager klokka sju.
 */
function streakMilestone(days: WeightDay[], today: string): WeightMilestone | null {
	const measured = new Set(days.map((d) => dayNumber(d.date)));
	let cursor = dayNumber(today);
	if (!measured.has(cursor)) cursor -= 1;

	let streak = 0;
	while (measured.has(cursor)) {
		streak++;
		cursor--;
	}

	if (streak < MIN_STREAK_DAYS) return null;
	return {
		kind: 'weigh-in-streak',
		sentence: `${streak} dager på rad med veiing.`,
		tone: 'positiv',
		basis: 'atferd'
	};
}

function coverageMilestone(days: WeightDay[], today: string): WeightMilestone | null {
	const todayNumber = dayNumber(today);
	const cutoff = todayNumber - COVERAGE_WINDOW_DAYS + 1;
	const count = days.filter((d) => {
		const n = dayNumber(d.date);
		return n >= cutoff && n <= todayNumber;
	}).length;

	if (count < MIN_COVERAGE_DAYS) return null;
	return {
		kind: 'weigh-in-coverage',
		sentence: `${count} av de siste ${COVERAGE_WINDOW_DAYS} dagene har en veiing.`,
		tone: 'positiv',
		basis: 'atferd'
	};
}

/**
 * Avstanden til lavpunktet — den nøytrale setningen som alltid har noe å si.
 *
 * Den er ikke en feiring, men den er orienterende, og den holder kortet fra å
 * være tomt i de periodene der ingen rekord fyrer. Lavpunktet er trendens, ikke
 * en enkeltmålings: å måle seg mot en dehydrert morgen i fjor er å måle seg mot
 * noe som aldri var sant.
 */
function nadirMilestone(ctx: RecordContext): WeightMilestone | null {
	if (!ctx.latestTrend) return null;

	let nadir: { date: string; value: number } | null = null;
	for (const point of ctx.points) {
		if (point.trend === null) continue;
		if (!nadir || point.trend < nadir.value) nadir = { date: point.date, value: point.trend };
	}
	if (!nadir || nadir.date === ctx.latestTrend.point.date) return null;

	const diff = round1(ctx.latestTrend.value - nadir.value);
	if (diff < NADIR_DISTANCE_FLOOR_KG) return null;

	return {
		kind: 'above-nadir',
		sentence: `${kg(diff)} kg over lavpunktet på ${kg(nadir.value)} kg, målt ${formatMilestoneDate(nadir.date)}.`,
		tone: 'nøytral',
		basis: 'trend',
		sinceDate: nadir.date
	};
}

const RANK: Record<MilestoneKind, number> = {
	'lowest-trend': 0,
	// Over det faste vinduet, med vilje: «ned 5,9 kg siden toppen i april» er den
	// samme historien fortalt der den faktisk begynte.
	'current-swing': 1,
	'largest-drop': 2,
	'below-goal': 3,
	'lowest-raw': 4,
	'weigh-in-streak': 5,
	'weigh-in-coverage': 6,
	'goal-distance': 7,
	'above-nadir': 8,
	stale: 9
};

export interface WeightMilestoneInput {
	/** Hele historikken, stigende. Fra `dailyWeights`. */
	days: WeightDay[];
	/** Dagens dato i Oslo, `YYYY-MM-DD`. Sendes inn så streaken kan testes. */
	today: string;
	/** Målvekt fra mortemaets `metricSettings.weight.goal`. */
	goalKg?: number | null;
}

export function buildWeightMilestones(input: WeightMilestoneInput): WeightMilestoneResult {
	const { days, today, goalKg } = input;
	const weighIns = days.length;

	if (weighIns === 0) {
		return { milestones: [], swings: [], historyDays: 0, weighIns: 0, enoughHistory: false };
	}

	const firstDate = days[0].date;
	const lastDate = days.at(-1)!.date;
	const historyDays = daysBetween(firstDate, lastDate);
	const enoughHistory = historyDays >= MIN_HISTORY_DAYS && weighIns >= MIN_HISTORY_WEIGH_INS;

	const points = buildMetricSeries(days, 'weight').points;
	const swings = findWeightSwings(points);
	const trendByDay = new Map<number, number>();
	for (const point of points) {
		if (point.trend !== null) trendByDay.set(dayNumber(point.date), point.trend);
	}

	let latestTrend: RecordContext['latestTrend'] = null;
	for (let i = points.length - 1; i >= 0; i--) {
		if (points[i].trend !== null) {
			latestTrend = { index: i, point: points[i], value: points[i].trend! };
			break;
		}
	}

	// Platå-vakta: har trenden faktisk falt den siste måneden? Uten et
	// sammenligningspunkt for en måned siden er svaret «vet ikke», altså nei.
	let hasRecentProgress = false;
	if (latestTrend) {
		const monthAgo = trendNear(
			trendByDay,
			dayNumber(latestTrend.point.date) - MIN_RECORD_SPAN_DAYS
		);
		hasRecentProgress = monthAgo !== null && latestTrend.value <= monthAgo - RECORD_MARGIN_KG;
	}

	const ctx: RecordContext = {
		days,
		points,
		swings,
		dayByDate: new Map(days.map((d) => [d.date, d])),
		trendByDay,
		latestTrend,
		firstDate,
		lastDate,
		historyDays,
		hasRecentProgress
	};

	const milestones: WeightMilestone[] = [];

	// Atferd først i koden, ikke i rangeringen: de er alltid gyldige, også når
	// målingene er for gamle til at rekorder betyr noe.
	const streak = streakMilestone(days, today);
	if (streak) milestones.push(streak);
	else {
		const coverage = coverageMilestone(days, today);
		if (coverage) milestones.push(coverage);
	}

	const staleDays = daysBetween(lastDate, today);
	if (staleDays > MAX_STALE_DAYS) {
		/**
		 * Gamle målinger stopper rekordene.
		 *
		 * «Snittvekta har ikke vært så lav siden i fjor» er en påstand om i dag, og
		 * uten en fersk måling er den en påstand om noe vi ikke vet. Setningen om
		 * hvorfor det er stille er mer nyttig enn en rekord fra forrige måned.
		 */
		milestones.push({
			kind: 'stale',
			sentence: `Siste veiing var ${formatMilestoneDate(lastDate)}, ${staleDays} dager siden. Rekordene venter på en ferskere måling.`,
			tone: 'nøytral',
			basis: 'atferd'
		});
		const goal = goalMilestone(ctx, goalKg);
		if (goal) milestones.push(goal);
		return { milestones: sortAndCap(milestones), swings, historyDays, weighIns, enoughHistory };
	}

	if (enoughHistory) {
		const lowestTrend = lowestTrendMilestone(ctx);
		if (lowestTrend) milestones.push(lowestTrend);

		const current = currentSwing(ctx.swings);
		if (current) milestones.push(currentSwingMilestone(ctx, current));

		/**
		 * Det faste vinduet vikes for en pågående NEDGANG.
		 *
		 * De to forteller da samme historie, og vinduet forteller den dårligere —
		 * det starter et vilkårlig antall dager tilbake framfor på toppen. En
		 * pågående OPPGANG er en annen historie enn et fall over året, og da får
		 * begge stå: «opp 2 kg siden juni, men fortsatt ned 4 kg på et år».
		 */
		const dropIsRetold = current?.direction === 'ned';
		const drop = dropIsRetold ? null : largestDropMilestone(ctx);
		if (drop) milestones.push(drop);

		const lowestRaw = lowestRawMilestone(ctx);
		/**
		 * Rå-rekorden droppes når trend-rekorden peker på omtrent samme dato: to
		 * setninger om samme hendelse leses som to hendelser, og den svakeste av
		 * dem får dermed låne troverdighet fra den sterkeste.
		 */
		if (lowestRaw && !echoesTrendRecord(lowestRaw, lowestTrend)) milestones.push(lowestRaw);

		const nadir = nadirMilestone(ctx);
		// Står du på lavpunktet, sier `lowest-trend` det bedre. Og er du på vei OPP
		// fra nettopp det lavpunktet, har `current-swing` alt sagt det — med tempo.
		// `currentSwing` gir bare en pågående periode, så retningen er nok her.
		const nadirRetold =
			nadir?.sinceDate !== undefined &&
			current?.direction === 'opp' &&
			Math.abs(daysBetween(current.startDate, nadir.sinceDate)) <= NADIR_ECHO_DAYS;
		if (nadir && !lowestTrend && !nadirRetold) milestones.push(nadir);
	}

	const goal = goalMilestone(ctx, goalKg);
	if (goal) milestones.push(goal);

	return { milestones: sortAndCap(milestones), swings, historyDays, weighIns, enoughHistory };
}

/** Sann når de to rekordene handler om samme periode. */
function echoesTrendRecord(
	raw: WeightMilestone,
	trend: WeightMilestone | null
): boolean {
	if (!trend) return false;
	if (!raw.sinceDate || !trend.sinceDate) return true;
	return Math.abs(daysBetween(raw.sinceDate, trend.sinceDate)) <= MIN_RECORD_SPAN_DAYS;
}

function sortAndCap(milestones: WeightMilestone[]): WeightMilestone[] {
	return milestones.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind]).slice(0, MAX_MILESTONES);
}
