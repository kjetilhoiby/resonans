/**
 * Krydderet på den daglige oversikten — én setning som sier hva som er verdt å
 * vite i dag, og stillhet når svaret er ingenting.
 *
 * Se `docs/changelog/2026-09-05-krydder-paa-dagsoversikten.md`.
 *
 * ## Hvorfor denne finnes
 *
 * Digest-pushen sa «Daglig oversikt / Planlagt: 0 · Åpne: 0 · Overliggere: 1»
 * fram til september 2026 — tre tellinger, to av dem null, og ingen av dem et
 * ord om hva som faktisk sto igjen. Det er nøyaktig samme feil som vekt-pushen
 * gjorde med «Veiing registrert / 94,2 kg»: setningene som gir tallene mening
 * lå ferdig regnet i motorene og nådde aldri varselet.
 *
 * Denne modulen regner derfor nesten ingenting selv. Den LESER motorene som alt
 * lager setninger — `effort-standing` (ukas plan, akutt/kronisk), `streaks`
 * (rekka og fristen), checklisten (navnet på overliggeren) — rangerer dem for
 * en push framfor for et kort, og setter sammen to linjer. To motorer i samme
 * tall blir aldri enige, og et varsel som sier noe annet enn flaten det lenker
 * til er verre enn et varsel uten fakta.
 *
 * ## Den ene regelen som er ny
 *
 * Ukesoppgjøret på vekta («Uka ble ned 0,4 kg») finnes ikke blant milepælene og
 * hører ikke hjemme der, av samme grunn som månedsoppgjøret i
 * `weight-nugget-rules.ts` ikke gjør det: et kort leses når som helst, mens en
 * påstand om uka som nettopp gikk bare er interessant på en morgen. En push har
 * et tidspunkt. Derfor bor den her, og bare her.
 *
 * ## Stillhet er et gyldig svar
 *
 * `buildDigestPush` returnerer **null** når ingen regel har noe å si. Det er
 * hele poenget: «Planlagt: 0» var en grunn til å sende, og en grunn til å sende
 * som alltid finnes gjør varselet til bakgrunnsstøy — og bakgrunnsstøy blir
 * slått av.
 *
 * Ren modul — ingen DB, ingen klokke. Kalleren sender inn `today`.
 */

import { buildMetricSeries, dayNumber, type MetricPoint, type WeightDay } from './health/weight-series';
import { kg } from './health/weight-text';
import { dueLabel, streakLabel, type StreakState } from './streaks';

export type DigestNuggetKind =
	/** En rekke med frist i dag eller i morgen. */
	| 'streak-due'
	/** Akutt/kronisk over terskelen — det ENESTE restitusjonssignalet vi har. */
	| 'load-high'
	/** Punkter fra i går som fortsatt står åpne, med navn. */
	| 'carryover'
	/** Uka som gikk, på vekta. */
	| 'week-change'
	/** Ukas effort mot båndet. */
	| 'week-load';

export interface DigestNugget {
	kind: DigestNuggetKind;
	/** Kortform, til en push-tittel. iOS kapper `sentence` midt i tallet. */
	headline: string;
	/** Hele setningen, med forbeholdene sine. */
	sentence: string;
}

/* ── Rekka som forfaller ──────────────────────────────────────────────────── */

/**
 * Hvor nær fristen må være før den er en nyhet.
 *
 * To dager: «forfaller om fem dager» er sant og ikke noe å gjøre med i dag, og
 * en rekke som varsles hver morgen gjennom hele intervallet er en teller, ikke
 * en beskjed.
 */
export const STREAK_DUE_WITHIN_DAYS = 1;

export interface DigestStreak {
	title: string;
	state: StreakState;
}

/**
 * «Løping forfaller i dag.»
 *
 * ## Hvorfor bare `due_soon`, aldri `overdue`
 *
 * En brutt rekke er sann og lett å regne, men «3 dager på overtid» levert i en
 * morgenpush er en anklage om noe som alt er avgjort — brukeren kan ikke gjøre
 * fristen ugjort. Samme beslutning som at terskelpasseringer på vekta bare
 * feires nedover: varselet skal bære det man kan handle på.
 *
 * Ordene kommer fra `streakLabel`/`dueLabel`, ikke herfra. Rekka heter det samme
 * i varselet som på kortet varselet lenker til; to formuleringer av «6 dager på
 * rad» driver fra hverandre uten at noen ser det.
 */
export function streakDueNugget(streaks: readonly DigestStreak[]): DigestNugget | null {
	const candidates = streaks.filter(
		(s) =>
			s.state.status === 'due_soon' &&
			s.state.count > 0 &&
			s.state.daysUntilDue !== null &&
			s.state.daysUntilDue >= 0 &&
			s.state.daysUntilDue <= STREAK_DUE_WITHIN_DAYS
	);
	if (candidates.length === 0) return null;

	// Nærmeste frist først; står to likt, vinner den lengste rekka — den har mest
	// å tape, og det er tapet som gjør beskjeden verdt å sende.
	const pick = candidates.slice().sort((a, b) => {
		const due = (a.state.daysUntilDue ?? 0) - (b.state.daysUntilDue ?? 0);
		return due !== 0 ? due : b.state.count - a.state.count;
	})[0];

	const due = dueLabel(pick.state);
	if (!due) return null;

	const run = streakLabel(pick.state);
	return {
		kind: 'streak-due',
		headline: `${pick.title} ${due}`,
		sentence: `${pick.title}: ${run}. Rekka ${due}.`
	};
}

/* ── Belastning ───────────────────────────────────────────────────────────── */

export interface DigestWeek {
	/** `describeBudgetStanding(...).text` — ukas effort mot båndet. */
	planText: string;
	/** `describeBudgetStanding(...).label` — kortformen. */
	planLabel: string;
	/** `describeAcuteChronic(...)`, når historikken rekker til. */
	loadText: string | null;
	loadLevel: 'rolig' | 'normal' | 'høy' | null;
}

/**
 * «Høy belastning.»
 *
 * Bare `høy`. `rolig` og `normal` er sanne hver eneste dag og sier ingenting å
 * handle på — de hører på kortet, der de er det motsatte hjørnet av samme akse.
 *
 * Akutt/kronisk er det ENESTE restitusjonssignalet som får varselfarge i denne
 * kodebasen, og det er grunnen til at det står nest øverst her: «over ukas plan»
 * er et budsjett man har brukt opp, dette er det nærmeste vi kommer et råd om
 * kroppen. Vi diagnostiserer fortsatt ingenting — setningen er motorens egen.
 */
export function loadHighNugget(week: DigestWeek | null): DigestNugget | null {
	if (!week || week.loadLevel !== 'høy' || !week.loadText) return null;
	return { kind: 'load-high', headline: 'Høy belastning', sentence: week.loadText };
}

/**
 * «Under ukas plan.»
 *
 * Kontinuerlig — det står alltid noe her — så den ligger nederst i rangeringen
 * og er i praksis en andrelinje. Setningen er `describeBudgetStanding` sin egen,
 * med forbeholdet om at planen er et budsjett og ikke en grense innebygd.
 */
export function weekLoadNugget(week: DigestWeek | null): DigestNugget | null {
	if (!week) return null;
	return { kind: 'week-load', headline: week.planLabel, sentence: week.planText };
}

/* ── Overliggere ──────────────────────────────────────────────────────────── */

/** Hvor mange punkter setningen rekker opp før den blir en liste å skumme. */
export const MAX_CARRYOVER_NAMED = 3;

export interface OpenItemsCopy {
	/** Kortform, til en push-tittel. */
	headline: string;
	/** Hele setningen, med tallet og navnene. */
	sentence: string;
}

/**
 * «Bytt dekk står igjen fra i går.»
 *
 * ## Navnet, ikke tellingen
 *
 * «Overliggere: 1» er sant og ubrukelig: brukeren må åpne appen for å finne ut
 * om det ene punktet er «ring rørleggeren» eller «ta ut av oppvaskmaskinen», og
 * det er nettopp den vurderingen som avgjør om varselet var verdt å få. Navnet
 * koster ingenting — det lå i checklisten hele tiden.
 *
 * `when` er halen som plasserer punktene i tid («fra i går», «i dag»). Den er en
 * parameter framfor tre kopier av samme setning: plan-dag, avslutt-dag og
 * dagsoversikten sier alle det samme om ulike dager, og tre formuleringer av
 * «står igjen» driver fra hverandre uten at noen ser det.
 */
export function describeOpenItems(
	titles: readonly string[],
	when: string
): OpenItemsCopy | null {
	const named = titles.map((t) => t.trim()).filter((t) => t.length > 0);
	if (named.length === 0) return null;

	const [first] = named;
	if (named.length === 1) {
		return { headline: `${first} står igjen`, sentence: `${first} står igjen ${when}.` };
	}

	const listed = named.slice(0, MAX_CARRYOVER_NAMED);
	const rest = named.length - listed.length;
	const tail = rest > 0 ? `, og ${rest} til` : '';
	return {
		headline: `${first} + ${named.length - 1} til står igjen`,
		sentence: `${named.length} punkter står igjen ${when}: ${listed.join(', ')}${tail}.`
	};
}

/** Punktene fra i går, som et krydder i dagsoversikten. */
export function carryoverNugget(titles: readonly string[]): DigestNugget | null {
	const copy = describeOpenItems(titles, 'fra i går');
	return copy ? { kind: 'carryover', ...copy } : null;
}

/* ── Uka på vekta ─────────────────────────────────────────────────────────── */

/** Under dette er «endringen» vektas egen usikkerhet, og uka sies uendret. */
export const WEEK_NOISE_FLOOR_KG = 0.3;

/**
 * Veiinger uka må ha før den kan oppsummeres.
 *
 * Fire av sju er tynt, men det er tynt på en måte som er synlig for den som
 * veier seg. Et ukesoppgjør fra to morgener er et oppgjør mellom to morgener.
 */
export const MIN_WEEK_WEIGH_INS = 4;

/** Hvor langt fra ukesskiftet et trendpunkt kan ligge og fortsatt brukes som anker. */
const WEEK_ANCHOR_TOLERANCE_DAYS = 2;

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Trendverdien nærmest en måldag, innenfor toleransen. */
function trendNear(trendByDay: Map<number, number>, targetDay: number): number | null {
	for (let offset = 0; offset <= WEEK_ANCHOR_TOLERANCE_DAYS; offset++) {
		const earlier = trendByDay.get(targetDay - offset);
		if (earlier !== undefined) return earlier;
		const later = trendByDay.get(targetDay + offset);
		if (later !== undefined) return later;
	}
	return null;
}

/**
 * «Uka ble ned 0,4 kg.»
 *
 * ## Begge ankrene ligger på TRENDEN, aldri på en rå måling
 *
 * Samme lærdom som månedsoppgjøret: trenden er et etterslepende snitt, så den
 * ligger noen dager bak virkeligheten i begge ender — måler man mellom to
 * punkter med SAMME etterslep, kansellerer etterslepet. To rå målinger sju dager
 * fra hverandre måler i stedet forskjellen mellom to morgeners væskebalanse, og
 * den er på størrelse med en måneds framgang.
 *
 * ## Hvorfor den ikke er en dublett av vekt-pushen
 *
 * Krydderet på veiingen sier REKORDER og MÅNEDEN. Ingen av reglene der svarer
 * på «hva ble uka», og et vindu på sju dager er nettopp det en morgenoversikt
 * har å si om vekta. Kjent rest: det finnes ingen bokføring av hva vekt-pushen
 * sa tidligere samme morgen, så en rekord og et ukesoppgjør kan bli sagt samme
 * dag på to flater.
 */
export function weekChangeNugget(days: readonly WeightDay[], today: string): DigestNugget | null {
	const todayDay = dayNumber(today);
	const weighIns = days.filter((d) => {
		const n = dayNumber(d.date);
		return n > todayDay - 7 && n <= todayDay;
	}).length;
	if (weighIns < MIN_WEEK_WEIGH_INS) return null;

	const trendByDay = new Map<number, number>();
	for (const point of buildMetricSeries([...days], 'weight').points as readonly MetricPoint[]) {
		if (point.trend !== null) trendByDay.set(dayNumber(point.date), point.trend);
	}

	const end = trendNear(trendByDay, todayDay);
	const start = trendNear(trendByDay, todayDay - 7);
	if (end === null || start === null) return null;

	const change = round1(end - start);
	if (Math.abs(change) < WEEK_NOISE_FLOOR_KG) {
		return {
			kind: 'week-change',
			headline: 'Uka endte uendret på vekta',
			sentence: `Uka endte uendret — snittvekta flyttet seg mindre enn ${kg(WEEK_NOISE_FLOOR_KG)} kg, målt over ${weighIns} veiinger.`
		};
	}

	const direction = change < 0 ? 'ned' : 'opp';
	return {
		kind: 'week-change',
		headline: `Uka ble ${direction} ${kg(change)} kg`,
		sentence: `Uka ble ${direction} ${kg(change)} kg på snittvekta, målt over ${weighIns} veiinger.`
	};
}

/* ── Rangering ────────────────────────────────────────────────────────────── */

/**
 * Rangeringen for en PUSH, som er en annen enn rangeringen for et kort.
 *
 * Samme prinsipp som `PUSH_RANK` i `weight-nugget-rules.ts`: **metning er
 * problemet rangeringen løser**. Det som fyrer ÉN gang ligger øverst, det som er
 * sant hver eneste morgen ligger nederst.
 *
 *  - `streak-due` fyrer bare i vinduet foran en frist, og har en handling i dag.
 *  - `load-high` fyrer bare over terskelen, og er det eneste restitusjonssignalet.
 *  - `carryover` fyrer bare når noe faktisk står igjen.
 *  - `week-change` og `week-load` er sanne hver dag, og hører i andrelinja.
 */
const PUSH_RANK: Record<DigestNuggetKind, number> = {
	'streak-due': 0,
	'load-high': 1,
	carryover: 2,
	'week-change': 3,
	'week-load': 4
};

/**
 * Par som forteller samme historie. Andrelinja skal ikke gjenta tittelen med
 * andre ord — to setninger om samme sak leses som to saker.
 *
 * **`streak-due` og `load-high` er med vilje IKKE et par**, selv om de kan se ut
 * til å motsi hverandre («løp i dag» ved siden av «ta en rolig dag»). De er to
 * sanne fakta om samme morgen, og kombinasjonen er nøyaktig det brukeren trenger
 * for å ta valget selv. Å skjule den ene ville vært å ta valget for hen.
 */
const ECHOES: Partial<Record<DigestNuggetKind, DigestNuggetKind[]>> = {
	'load-high': ['week-load'],
	'week-load': ['load-high']
};

export interface DigestNuggetInput {
	/** Dagens Oslo-dato, `YYYY-MM-DD`. */
	today: string;
	/** En aktiv sykeperiode. Da sender vi ingenting — se `buildDigestPush`. */
	sick: boolean;
	streaks: readonly DigestStreak[];
	/** Titlene på punktene fra i går som fortsatt står åpne. */
	carryover: readonly string[];
	/** Hele vekthistorikken som dagsverdier, stigende. */
	weightDays: readonly WeightDay[];
	week: DigestWeek | null;
}

/** Alt vi kan si i dag, sterkest først. */
export function digestNuggets(input: DigestNuggetInput): DigestNugget[] {
	return [
		streakDueNugget(input.streaks),
		loadHighNugget(input.week),
		carryoverNugget(input.carryover),
		weekChangeNugget(input.weightDays, input.today),
		weekLoadNugget(input.week)
	]
		.filter((n): n is DigestNugget => n !== null)
		.sort((a, b) => PUSH_RANK[a.kind] - PUSH_RANK[b.kind]);
}

export interface DigestPushCopy {
	title: string;
	body: string;
	nugget: DigestNugget;
	/** Andrelinja, når en annen enn tittelen hadde noe å si. */
	secondary: DigestNugget | null;
}

/**
 * De to linjene i dagsoversikten — eller **null**, som betyr «ikke send».
 *
 * ## Sykdom slår alt av
 *
 * En aktiv sykeperiode gir ingen push herfra. Innsjekken (`sick-checkin`) eier
 * den morgenen, og de andre nudgene maser om å GJØRE noe — som er feil når man
 * ligger nede. «Under ukas plan — det er rom igjen» levert til noen med feber er
 * ikke en oversikt, det er en oppfordring. `describeBudgetStanding` senker
 * riktignok rammen i en sykeuke, men den riktige mengden her er ingen.
 *
 * ## Tittelen er krydderet, body-en bærer tallet
 *
 * Overskriften er kortformen, fordi iOS kapper en lang setning midt i tallet.
 * Setningen står under, med forbeholdene sine — et krydder uten tallet under er
 * en påstand brukeren ikke kan etterprøve.
 */
export function buildDigestPush(input: DigestNuggetInput): DigestPushCopy | null {
	if (input.sick) return null;

	const nuggets = digestNuggets(input);
	const headline = nuggets[0];
	if (!headline) return null;

	const echoes = new Set(ECHOES[headline.kind] ?? []);
	const secondary = nuggets.find((n) => n !== headline && !echoes.has(n.kind)) ?? null;

	return {
		title: headline.headline,
		body: [headline.sentence, secondary?.headline].filter(Boolean).join(' · '),
		nugget: headline,
		secondary
	};
}
