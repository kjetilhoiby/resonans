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

import { dayNumber, buildMetricSeries, type WeightDay } from './weight-series';
import {
	buildWeightMilestones,
	type MilestoneKind,
	type WeightMilestone
} from './weight-milestones';
import { formatMonthName, kg } from './weight-text';

export type WeightNuggetKind = MilestoneKind | 'month-change';

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
export function monthChangeNugget(days: WeightDay[], today: string): WeightNugget | null {
	if (Number(today.slice(8, 10)) > MONTH_SUMMARY_WINDOW_DAYS) return null;

	const month = monthsBefore(today.slice(0, 7), 1);
	const weighIns = days.filter((d) => d.date.slice(0, 7) === month).length;
	if (weighIns < MIN_MONTH_WEIGH_INS) return null;

	const trendByDay = new Map<number, number>();
	for (const point of buildMetricSeries(days, 'weight').points) {
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

/**
 * Rangeringen for en PUSH, som er en annen enn rangeringen for kortet.
 *
 * Kortet svarer på «hvor står jeg» og leses når brukeren selv åpner det, så der
 * vinner den sterkeste rekorden. Et varsel dytter seg på deg i det du stiger av
 * vekta, og da vinner det som er sjeldnest å få høre: månedsoppgjøret fyrer fem
 * dager i måneden, en rekord kan fyre hver morgen i en nedgangsperiode.
 *
 * Måloppnåelse (`below-goal`) er løftet over de øvrige rekordene av samme grunn
 * — den skjer én gang.
 *
 * Avstanden til målet ligger over atferdsmilepælene, motsatt av på kortet. Der
 * er `weigh-in-streak` den ene setningen som er sann uansett hvilken vei vekta
 * går, og den plassen har den fortjent. I et varsel om en veiing er «1,8 kg til
 * målet på 90,0 kg» likevel det mer opplysende av de to — brukeren vet at hen
 * nettopp veide seg.
 */
const PUSH_RANK: Record<WeightNuggetKind, number> = {
	'month-change': 0,
	'below-goal': 1,
	'lowest-trend': 2,
	'current-swing': 3,
	'largest-drop': 4,
	'lowest-raw': 5,
	'goal-distance': 6,
	'weigh-in-streak': 7,
	'weigh-in-coverage': 8,
	'above-nadir': 9,
	stale: 10
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
	'lowest-trend': ['lowest-raw', 'above-nadir'],
	'lowest-raw': ['lowest-trend'],
	'current-swing': ['largest-drop', 'above-nadir'],
	'largest-drop': ['current-swing'],
	'weigh-in-streak': ['weigh-in-coverage'],
	'weigh-in-coverage': ['weigh-in-streak'],
	'below-goal': ['goal-distance'],
	'goal-distance': ['below-goal']
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

/** Alt vi kan si om denne veiingen, sterkest først. */
export function weightNuggets(input: WeightNuggetInput): WeightNugget[] {
	const { milestones, all } = buildWeightMilestones({
		days: input.days,
		today: input.today,
		goalKg: input.goalKg
	});
	// `all` er ukappet; `milestones` er fallbacken hvis feltet en dag forsvinner.
	const fromMilestones = (all.length > 0 ? all : milestones).map(toNugget);

	const month = monthChangeNugget(input.days, input.today);
	const nuggets = month ? [month, ...fromMilestones] : fromMilestones;

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
