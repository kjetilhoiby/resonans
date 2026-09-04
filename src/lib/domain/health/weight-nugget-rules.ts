/**
 * Krydderet på en veiing — én setning som sier hva som var spesielt.
 *
 * Se `docs/changelog/2026-09-04-krydder-paa-veiingen.md`.
 *
 * ## Hvorfor denne finnes ved siden av milepælene
 *
 * Vekt-pushen sa «Veiing registrert / 94,2 kg» fram til september 2026 — tallet
 * brukeren nettopp leste av på vekta, uten ett ord om hva det betydde. Øktene
 * fikk krydder («Lengste løpetur i år!») i august, og vekta har mer historikk å
 * si noe fra enn treningen har.
 *
 * Regnestykkene fantes allerede, i `weight-milestones.ts`. Denne modulen regner
 * derfor **ingen rekord på nytt**: den leser milepælsmotoren, rangerer den for
 * en push framfor for et kort, og setter sammen to linjer. To motorer i samme
 * kurve blir aldri enige, og et varsel som sier noe annet enn flaten det lenker
 * til er verre enn et varsel uten fakta.
 *
 * ## Den ene regelen som er ny
 *
 * Månedsoppgjøret («August ble ned 1,2 kg») finnes ikke blant milepælene, og
 * hører ikke hjemme der: et kort leses når som helst, og en påstand om måneden
 * som nettopp tok slutt er bare interessant de første dagene etterpå. En push
 * har derimot et tidspunkt. Derfor bor den her, og bare her.
 *
 * Ren modul — ingen DB, ingen klokke. Kalleren sender inn `today`.
 */

import {
	dayNumber,
	daysBetween,
	buildMetricSeries,
	type MetricPoint,
	type WeightDay
} from './weight-series';
import {
	buildWeightMilestones,
	MIN_RECORD_SPAN_DAYS,
	type MilestoneKind,
	type WeightMilestone
} from './weight-milestones';
import { currentSwing, type WeightSwing } from './weight-swings';
import {
	buildCycleSeries,
	compareCurrentToPrevious,
	describeCycleComparison
} from './cycle-series';
import { formatMilestoneDate, formatMonthName, formatMonthYear, kg } from './weight-text';

export type WeightNuggetKind =
	| MilestoneKind
	| 'month-change'
	| 'threshold-crossed'
	| 'goal-progress'
	| 'year-over-year';

export interface WeightNugget {
	kind: WeightNuggetKind;
	/** Kortform, til en push-tittel. iOS kapper `sentence` midt i tallet. */
	headline: string;
	/** Hele setningen, med forbeholdene sine. Til en andrelinje eller en chat. */
	sentence: string;
}

/**
 * Hvor mange dager inn i en ny måned månedsoppgjøret fortsatt er en nyhet.
 *
 * Fem: en veiing hopper over dager, så en fast «bare den 1.» ville truffet
 * omtrent annenhver måned. Etter den femte er august gammelt nytt.
 */
export const MONTH_SUMMARY_WINDOW_DAYS = 5;

/**
 * Dager med veiing måneden må ha før den kan oppsummeres.
 *
 * Ti av tretti er tynt, men det er tynt på en måte som er synlig for den som
 * veier seg — og et månedsoppgjør fra tre veiinger er et oppgjør mellom tre
 * morgener, ikke mellom to måneder.
 */
export const MIN_MONTH_WEIGH_INS = 10;

/** Under dette er «endringen» vektas egen usikkerhet, og måneden sies uendret. */
export const MONTH_NOISE_FLOOR_KG = 0.3;

/** Hvor langt fra månedsskiftet et trendpunkt kan ligge og fortsatt brukes som anker. */
const MONTH_ANCHOR_TOLERANCE_DAYS = 3;

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function isoFromDayNumber(day: number): string {
	return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Siste dag i måneden `YYYY-MM` ligger i, som dagnummer. */
function lastDayOfMonth(monthKey: string): number {
	const [year, month] = monthKey.split('-').map(Number);
	// Dag 0 i neste måned er siste dag i denne.
	return Math.round(Date.UTC(year, month, 0) / 86_400_000);
}

/** `YYYY-MM` n måneder før `monthKey`. */
function monthsBefore(monthKey: string, n: number): string {
	const [year, month] = monthKey.split('-').map(Number);
	const total = year * 12 + (month - 1) - n;
	return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Trendverdien nærmest en måldag, innenfor toleransen. */
function trendNear(trendByDay: Map<number, number>, targetDay: number): number | null {
	for (let offset = 0; offset <= MONTH_ANCHOR_TOLERANCE_DAYS; offset++) {
		const earlier = trendByDay.get(targetDay - offset);
		if (earlier !== undefined) return earlier;
		const later = trendByDay.get(targetDay + offset);
		if (later !== undefined) return later;
	}
	return null;
}

/**
 * «August ble ned 1,2 kg.»
 *
 * ## Hvorfor begge ankrene ligger på et månedsSKIFTE
 *
 * Endringen måles som trenden ved utgangen av måneden minus trenden ved
 * utgangen av forrige måned — ikke fra den 1. til den 31. Trenden er et
 * etterslepende sjudagerssnitt, så den ligger noen dager bak virkeligheten i
 * begge ender; måler man mellom to punkter med SAMME etterslep, kansellerer det.
 * Med den 1. som startanker ville halve vinduet ligget i forrige måned, og
 * «august» ville i praksis dekket 25. juli–25. august.
 *
 * Trenden brukes framfor månedssnittene (`weight-monthly.ts`) fordi et snitt av
 * hele august mot et snitt av hele juli svarer på et annet spørsmål: forskjellen
 * mellom to nivåer, ikke bevegelsen gjennom måneden. På en jevn nedgang gir
 * snittene omtrent halvparten av det som faktisk skjedde.
 */
export function monthChangeNugget(
	days: WeightDay[],
	today: string,
	/** Trendserien, når kalleren alt har regnet den. Ellers regnes den her. */
	precomputed?: readonly MetricPoint[]
): WeightNugget | null {
	if (Number(today.slice(8, 10)) > MONTH_SUMMARY_WINDOW_DAYS) return null;

	const month = monthsBefore(today.slice(0, 7), 1);
	const weighIns = days.filter((d) => d.date.slice(0, 7) === month).length;
	if (weighIns < MIN_MONTH_WEIGH_INS) return null;

	const trendByDay = new Map<number, number>();
	for (const point of precomputed ?? buildMetricSeries(days, 'weight').points) {
		if (point.trend !== null) trendByDay.set(dayNumber(point.date), point.trend);
	}

	const end = trendNear(trendByDay, lastDayOfMonth(month));
	const start = trendNear(trendByDay, lastDayOfMonth(monthsBefore(month, 1)));
	if (end === null || start === null) return null;

	const change = round1(end - start);
	const name = formatMonthName(month);

	if (Math.abs(change) < MONTH_NOISE_FLOOR_KG) {
		return {
			kind: 'month-change',
			headline: `${name} endte uendret`,
			sentence: `${name} endte uendret — snittvekta flyttet seg mindre enn ${kg(MONTH_NOISE_FLOOR_KG)} kg gjennom måneden, målt over ${weighIns} veiinger.`
		};
	}

	const direction = change < 0 ? 'ned' : 'opp';
	return {
		kind: 'month-change',
		headline: `${name} ble ${direction} ${kg(change)} kg`,
		sentence: `${name} ble ${direction} ${kg(change)} kg på snittvekta, målt over ${weighIns} veiinger.`
	};
}

/* ── Terskler passert ─────────────────────────────────────────────────────── */

/**
 * Hele kilo. Ikke femmere.
 *
 * «Under 95» og «under 94» feires begge; en femmerskala ville gitt to varsler
 * på to år og latt elleve ekte passeringer gå ubemerket. Og ikke halve kilo:
 * trenden krysser 94,5 og 94,0 i samme uke, og da er passeringen ikke lenger
 * en nyhet men en teller.
 */
export const THRESHOLD_STEP_KG = 1;

/**
 * Bare NEDOVER, og det er en beslutning.
 *
 * En oppovergående passering er sann og lett å regne, men «Over 96 kg for
 * første gang siden mars» er en anklage levert i det brukeren stiger av vekta.
 * Atferdsmilepælene (streak, dekning) er det som skal bære de ukene vekta
 * stiger — de er sanne uansett retning, og de handler om noe man styrer.
 */
export function thresholdCrossedNugget(
	points: readonly MetricPoint[],
	enoughHistory: boolean
): WeightNugget | null {
	if (!enoughHistory) return null;

	const trend = points.filter(
		(p): p is MetricPoint & { trend: number } => p.trend !== null
	);
	if (trend.length < 2) return null;

	const last = trend[trend.length - 1];
	const previous = trend[trend.length - 2];
	if (last.trend >= previous.trend) return null;

	// Heltallene som ligger mellom forrige og dagens trend. Krysses flere i ett
	// steg, er det LAVESTE den sanne nyheten — «under 94» slår «under 95».
	const lowest = Math.floor(last.trend) + THRESHOLD_STEP_KG;
	if (lowest > previous.trend || lowest <= last.trend) return null;

	// Forrige gang trenden lå under den samme terskelen, før dagens passering.
	let since: string | null = null;
	for (let i = trend.length - 2; i >= 0; i--) {
		if (trend[i].trend < lowest) {
			since = trend[i].date;
			break;
		}
	}

	/**
	 * En passering som gjentar seg er ikke en passering.
	 *
	 * Trenden kan vippe over og under den samme terskelen noen dager på rad. Uten
	 * denne vakta ville «under 95 kg for første gang siden — for fire dager
	 * siden» fyrt gjentatte ganger på samme kilo, altså nøyaktig den metningen
	 * terskelregelen finnes for å bryte.
	 */
	if (since !== null && daysBetween(since, last.date) < MIN_RECORD_SPAN_DAYS) return null;

	const label = `Under ${lowest} kg`;
	if (since === null) {
		return {
			kind: 'threshold-crossed',
			headline: `${label} for første gang`,
			sentence: `Snittvekta er under ${lowest} kg for første gang i hele historikken.`
		};
	}

	return {
		kind: 'threshold-crossed',
		headline: `${label} for første gang siden ${formatMonthYear(since)}`,
		sentence: `Snittvekta er under ${lowest} kg for første gang siden ${formatMilestoneDate(since)}.`
	};
}

/* ── Andel av veien til målet ─────────────────────────────────────────────── */

/** Andelene som er verdt et varsel. Fyrer én gang hver, på veien ned. */
export const GOAL_PROGRESS_MARKS = [0.25, 0.5, 0.75, 0.9] as const;

function progressLabel(mark: number): string {
	return mark === 0.5 ? 'Halvveis' : `${Math.round(mark * 100)} % av veien`;
}

/**
 * «Halvveis til 93 kg.»
 *
 * ## Baselinen er periodens topp, og setningen SIER det
 *
 * En andel trenger et startpunkt, og målvekta i `metricSettings.weight.goal` er
 * et bart tall uten et. Startpunktet her er toppen av den pågående nedgangen
 * (`weight-swings`) — det nærmeste vi kommer «der dette begynte» uten å lese
 * `sensor_goals`.
 *
 * Derfor navngis den i setningen: «Halvveis fra 104,2 kg (april) til 93 kg» kan
 * etterprøves, mens et bart «halvveis til målet» ville vært en påstand om et
 * startpunkt brukeren ikke kan se — og et annet startpunkt enn det hen selv
 * hadde i hodet. Samme regel som at målvekt fra to kilder må navngis.
 */
export function goalProgressNugget(
	points: readonly MetricPoint[],
	swings: readonly WeightSwing[],
	goalKg: number | null | undefined
): WeightNugget | null {
	if (typeof goalKg !== 'number' || !Number.isFinite(goalKg) || goalKg <= 0) return null;

	const swing = currentSwing(swings);
	if (!swing || swing.direction !== 'ned') return null;

	const span = swing.startKg - goalKg;
	// Startet perioden alt under målet, finnes det ingen vei å måle andel av.
	if (span <= 0) return null;

	const trend = points.filter(
		(p): p is MetricPoint & { trend: number } => p.trend !== null
	);
	if (trend.length < 2) return null;

	const now = (swing.startKg - trend[trend.length - 1].trend) / span;
	const before = (swing.startKg - trend[trend.length - 2].trend) / span;
	// Målet selv er `below-goal` sin beskjed, ikke en andel.
	if (now >= 1) return null;

	const crossed = GOAL_PROGRESS_MARKS.filter((mark) => before < mark && now >= mark);
	if (crossed.length === 0) return null;

	// Krysses to merker i ett steg, er det høyeste den sanne nyheten.
	const mark = crossed[crossed.length - 1];
	return {
		kind: 'goal-progress',
		headline: `${progressLabel(mark)} til ${kg(goalKg)} kg`,
		sentence: `${progressLabel(mark)} fra ${kg(swing.startKg)} kg (${formatMonthYear(swing.startDate)}) til målet på ${kg(goalKg)} kg.`
	};
}

/* ── Samme dato i fjor ────────────────────────────────────────────────────── */

/** Under dette er et års forskjell ikke en nyhet. */
export const YEAR_OVER_YEAR_FLOOR_KG = 1;

/** Hvor mange år sesongmotoren får se. Samme tak som `WeightYearsCard`. */
const MAX_CYCLE_YEARS = 10;

/**
 * «2,4 kg under i fjor på samme dato.»
 *
 * Motoren er `cycle-series.ts`, den samme `WeightYearsCard` bruker — og den
 * mates med de samme TRENDverdiene. Rå målinger ville sammenlignet én morgen
 * mot én morgen for et år siden, altså to væskevekter.
 *
 * Ordforrådet er `position`: et nivå har ingen god retning, og «foran i fjor»
 * ville lagt en dom på tallet.
 *
 * Denne er den ene av krydderne som ikke METTER. Sammenligningsdagen flytter
 * seg hver morgen, så tallet er nytt hver dag — i motsetning til «laveste
 * snittvekt vi har målt», som står uendret gjennom en hel nedgangsperiode.
 */
export function yearOverYearNugget(
	points: readonly MetricPoint[],
	today: string
): WeightNugget | null {
	const trendDays = points
		.filter((p) => p.trend !== null)
		.map((p) => ({ date: p.date, value: p.trend as number }));
	if (trendDays.length === 0) return null;

	const series = buildCycleSeries(trendDays, {
		cycle: 'year',
		mode: 'level',
		today,
		maxSeries: MAX_CYCLE_YEARS
	});
	const comparison = compareCurrentToPrevious(series);
	if (!comparison?.previous) return null;

	const diff = comparison.current - comparison.previous.value;
	if (Math.abs(diff) < YEAR_OVER_YEAR_FLOOR_KG) return null;

	const sentence = describeCycleComparison(comparison, {
		unit: 'kg',
		decimals: 1,
		vocabulary: 'position',
		previousNoun: 'i fjor'
	});
	if (!sentence) return null;

	return {
		kind: 'year-over-year',
		headline: `${kg(diff)} kg ${diff < 0 ? 'under' : 'over'} i fjor`,
		sentence
	};
}

/**
 * Rangeringen for en PUSH, som er en annen enn rangeringen for kortet.
 *
 * Kortet svarer på «hvor står jeg» og leses når brukeren selv åpner det, så der
 * vinner den sterkeste rekorden. Et varsel dytter seg på deg i det du stiger av
 * vekta, og da vinner det som er sjeldnest å få høre.
 *
 * ## Metning er problemet rangeringen løser
 *
 * «Laveste snittvekt siden [dato]» flytter referansen bakover helt til den
 * treffer taket, og blir så stående på «Laveste snittvekt vi har målt» —
 * identisk hver morgen så lenge nedgangen varer. Over et toårsmål er det
 * flertallet av morgenene. Rekorder er altså ikke sjeldne; de er KONTINUERLIGE.
 *
 * Derfor ligger de fire som fyrer ÉN gang øverst: måloppnåelse (én gang),
 * en passert kilo-terskel (én gang per kilo), et andelsmerke på veien til målet
 * (fire ganger), og månedsoppgjøret (fem dager i måneden).
 *
 * `year-over-year` er plassert rett under den sterkeste rekorden med vilje, og
 * det er en beslutning om ANDRELINJA: tittelen metter, så den varierende
 * setningen gjør mest nytte i slot nummer to. Sammenligningsdagen flytter seg
 * hver morgen, så tallet er nytt hver dag.
 *
 * Avstanden til målet ligger over atferdsmilepælene, motsatt av på kortet. Der
 * er `weigh-in-streak` den ene setningen som er sann uansett hvilken vei vekta
 * går, og den plassen har den fortjent. I et varsel om en veiing er «1,8 kg til
 * målet på 90,0 kg» likevel det mer opplysende av de to — brukeren vet at hen
 * nettopp veide seg.
 */
const PUSH_RANK: Record<WeightNuggetKind, number> = {
	'below-goal': 0,
	'threshold-crossed': 1,
	'goal-progress': 2,
	'month-change': 3,
	'lowest-trend': 4,
	'year-over-year': 5,
	'current-swing': 6,
	'largest-drop': 7,
	'lowest-raw': 8,
	'goal-distance': 9,
	'weigh-in-streak': 10,
	'weigh-in-coverage': 11,
	'above-nadir': 12,
	stale: 13
};

/**
 * Par som forteller samme historie. Andrelinja skal ikke gjenta tittelen med
 * andre ord — to setninger om samme hendelse leses som to hendelser.
 *
 * Milepælsmotoren luker ut de fleste av disse selv (`echoesTrendRecord`,
 * `dropIsRetold`, streak-før-dekning). Lista står her fordi den er billig, og
 * fordi den holder også hvis motoren en dag slipper begge gjennom.
 */
const ECHOES: Partial<Record<WeightNuggetKind, WeightNuggetKind[]>> = {
	'lowest-trend': ['lowest-raw', 'above-nadir', 'threshold-crossed'],
	'lowest-raw': ['lowest-trend'],
	// En passert terskel er nesten alltid også en trendrekord: er du under 94 for
	// første gang siden 2019, er du per definisjon lavest siden 2019. To
	// setninger om samme hendelse leses som to hendelser.
	'threshold-crossed': ['lowest-trend', 'lowest-raw'],
	'current-swing': ['largest-drop', 'above-nadir'],
	'largest-drop': ['current-swing'],
	'weigh-in-streak': ['weigh-in-coverage'],
	'weigh-in-coverage': ['weigh-in-streak'],
	// Alle tre snakker om avstanden til den samme målvekta.
	'below-goal': ['goal-distance', 'goal-progress'],
	'goal-progress': ['goal-distance', 'below-goal'],
	'goal-distance': ['below-goal', 'goal-progress']
};

export interface WeightNuggetInput {
	/** Hele historikken som dagsverdier, stigende — inkludert dagens veiing. */
	days: WeightDay[];
	/** Dagens Oslo-dato, `YYYY-MM-DD`. */
	today: string;
	/** Målvekt fra Helse-mortemaets `metricSettings.weight.goal`. */
	goalKg?: number | null;
}

function toNugget(milestone: WeightMilestone): WeightNugget {
	return { kind: milestone.kind, headline: milestone.headline, sentence: milestone.sentence };
}

/**
 * Alt vi kan si om denne veiingen, sterkest først.
 *
 * Trendserien regnes ÉN gang og deles av reglene. De tre nyeste spør alle om
 * «hva var trenden i går mot i dag», og tre uavhengige `buildMetricSeries`-kall
 * over hele historikken ville vært tre ganger jobben for det samme svaret.
 */
export function weightNuggets(input: WeightNuggetInput): WeightNugget[] {
	const { milestones, all, swings, enoughHistory } = buildWeightMilestones({
		days: input.days,
		today: input.today,
		goalKg: input.goalKg
	});
	// `all` er ukappet; `milestones` er fallbacken hvis feltet en dag forsvinner.
	const fromMilestones = (all.length > 0 ? all : milestones).map(toNugget);

	const points = buildMetricSeries(input.days, 'weight').points;

	const nuggets = [
		monthChangeNugget(input.days, input.today, points),
		thresholdCrossedNugget(points, enoughHistory),
		goalProgressNugget(points, swings, input.goalKg),
		yearOverYearNugget(points, input.today),
		...fromMilestones
	].filter((n): n is WeightNugget => n !== null);

	return nuggets.slice().sort((a, b) => PUSH_RANK[a.kind] - PUSH_RANK[b.kind]);
}

export interface WeightPushCopy {
	title: string;
	body: string;
	/** Krydderet tittelen kom fra. Null når historikken ikke hadde noe å si. */
	nugget: WeightNugget | null;
	/** Andrelinja, når en annen enn tittelen hadde noe å si. */
	secondary: WeightNugget | null;
}

export interface WeightPushInput extends WeightNuggetInput {
	/** Målingen som nettopp ble skrevet — den brukeren står og venter på. */
	latestKg: number | null;
}

/**
 * De to linjene i vekt-pushen.
 *
 * **Vekta står alltid først i body-en.** Tittelen er krydderet, og et krydder
 * uten tallet under er en påstand brukeren ikke kan etterprøve mens hen står på
 * badet. Uten krydder faller tittelen tilbake på den nøytrale beskjeden — en
 * push som later som den vet noe er verre enn en som bare bekrefter målingen.
 */
export function buildWeightPush(input: WeightPushInput): WeightPushCopy {
	const nuggets = weightNuggets(input);
	const headline = nuggets[0] ?? null;

	const echoes = headline ? new Set(ECHOES[headline.kind] ?? []) : new Set<WeightNuggetKind>();
	const secondary =
		nuggets.find((n) => n !== headline && !echoes.has(n.kind)) ?? null;

	const weightText = input.latestKg !== null ? `${kg(input.latestKg)} kg` : null;

	return {
		title: headline?.headline ?? 'Veiing registrert',
		body: [weightText, secondary?.headline].filter(Boolean).join(' · ') || 'Ny veiing registrert',
		nugget: headline,
		secondary
	};
}
