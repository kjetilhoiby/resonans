/**
 * Toppene og bunnene på vektkurven, og strekkene mellom dem.
 *
 * ## Hvorfor dette finnes ved siden av milepælene
 *
 * Milepælene måler over **navngitte, faste vinduer** — 30, 90, 180, 365 dager.
 * Det er med vilje: skanner man alle vinduslengder etter det største fallet,
 * finner man alltid noe, og svaret blir «største 3-dagersfall», altså væsketap.
 *
 * Prisen er at et fast vindu sjelden treffer der bevegelsen faktisk begynte. En
 * nedgang som startet i april og økte i tempo i juli leses av 365-dagersvinduet
 * som «ned 1,8 kg på et år» — sant, og likevel en dårlig beskrivelse av hva som
 * skjedde. Vinduet blander tolv måneder med tre ulike retninger.
 *
 * Løsningen er ikke å søke fritt etter det beste vinduet, men å la KURVEN
 * bestemme grensene: topp til bunn, bunn til topp. Da er hvert strekk én retning,
 * og tempoet i det er tempoet i noe som faktisk hendte.
 *
 * ## Trenden, aldri målingene
 *
 * Alt her leser det etterslepende 7-dagerssnittet. Kroppsvekt spriker et kilo på
 * væske alene, så «topper og bunner» på rå veiinger er en liste over dehydrerte
 * morgener.
 *
 * ## Hvordan et vendepunkt bekreftes
 *
 * En periode avsluttes først når trenden har snudd `REBOUND_TOLERANCE_KG` fra
 * ytterpunktet — ikke ved den første motsatte dagen. Uten toleransen ville hver
 * lille bølge delt en reell nedgang i tjue biter, og et platå midt i den ville
 * avsluttet den. Med toleransen er ytterpunktet fortsatt det ekte: strekket
 * starter og slutter på topp- og bunnverdien, ikke der bekreftelsen kom.
 *
 * **To terskler, to jobber.** `REBOUND_TOLERANCE_KG` avgjør STRUKTUREN (når en
 * periode er over), `MIN_SWING_KG`/`MIN_SWING_DAYS` avgjør hva som er verdt å
 * VISE. De må være ulike tall: en struktur-terskel på 2 kg ville slått sammen
 * perioder som gikk motsatt vei, og en visningsterskel på 1 kg ville fylt lista
 * med væske.
 *
 * Konsekvensen er at listen ikke er sammenhengende: mellom to viste perioder kan
 * det ligge bevegelse som ikke nådde terskelen. Flaten må si det — en liste som
 * ser komplett ut, men ikke er det, er verre enn en med et forbehold.
 */

import { dayNumber, type MetricPoint } from './weight-series';
import { describeSpan, formatMilestoneDate, formatShortDate, kg, kg2 } from './weight-text';

/** Under dette er «perioden» væske, ikke en bevegelse. Gjelder begge retninger. */
export const MIN_SWING_KG = 2;

/** Kortere enn tre uker er en svingning, ikke en periode man kan lære av. */
export const MIN_SWING_DAYS = 21;

/**
 * Hvor mye trenden må snu fra ytterpunktet før perioden regnes som avsluttet.
 *
 * Målt på trenden, ikke på rå målinger — så et helt kilo er et reelt vendepunkt
 * og ikke bare en tung dag. Lavere verdi ville delt en nedgang med platå i to.
 */
export const REBOUND_TOLERANCE_KG = 1;

/**
 * Vinduet den pågående perioden får et ekstra tempotall for.
 *
 * En nedgang som varer et halvår har som regel ikke ett tempo. «1,4 kg i
 * måneden» over hele strekket skjuler at de siste ukene gikk dobbelt så fort —
 * og det er nettopp den endringen brukeren kjenner igjen og vil ha bekreftet.
 */
export const PACE_WINDOW_DAYS = 30;

/**
 * Hvor mye tempoet må avvike før det nevnes, i kg per måned.
 *
 * Under dette er forskjellen trendens eget etterslep, ikke en endring i hva
 * kroppen gjør.
 */
export const PACE_SHIFT_KG_PER_MONTH = 0.5;

/**
 * Krav til lengde før tempoet i sluttdelen sammenlignes med helheten.
 *
 * Uten kravet sammenlignes perioden med seg selv: er strekket 35 dager, dekker
 * «siste 30» nesten alt, og «raskere nå» blir en avrundingsfeil med selvtillit.
 */
export const MIN_DAYS_FOR_PACE_SHIFT = PACE_WINDOW_DAYS * 2;

/**
 * Hvor mye trenden må ha snudd fra en pågående periodes ytterpunkt før det nevnes.
 *
 * **Må være mindre enn `REBOUND_TOLERANCE_KG`**, ellers er feltet dødt kode: et
 * tilbakeslag på et helt kilo har alt bekreftet vendingen, og perioden er da ikke
 * pågående lenger. Første utgave brukte `MIN_SWING_KG / 2`, som er nøyaktig
 * vendeterskelen — `retraceKg` kunne aldri settes, og en bunn som lå tre uker
 * tilbake ble presentert som «faller fortsatt».
 */
export const MIN_RETRACE_KG = 0.3;

/** Hvor langt fra en måldag en trendverdi kan ligge og fortsatt brukes. */
export const LOOKUP_TOLERANCE_DAYS = 3;

const DAYS_PER_MONTH = 30.44;

export type SwingDirection = 'ned' | 'opp';

export interface SwingPace {
	/** Dager tempoet er regnet over. Kan være færre enn `PACE_WINDOW_DAYS`. */
	days: number;
	kgPerMonth: number;
	/** Sann når sluttdelen går raskere enn perioden som helhet. */
	faster: boolean;
}

export interface WeightSwing {
	direction: SwingDirection;
	/** Toppen for en nedgang, bunnen for en oppgang. */
	startDate: string;
	endDate: string;
	startKg: number;
	endKg: number;
	/** Alltid positiv. Retningen står i `direction`. */
	changeKg: number;
	days: number;
	kgPerWeek: number;
	kgPerMonth: number;
	/**
	 * Sann når ingen bekreftet vending har avsluttet perioden.
	 *
	 * En pågående periode er ikke det samme som «fram til i dag»: den slutter på
	 * ytterpunktet, og `retraceKg` sier hvor langt trenden har snudd derfra uten
	 * at vendingen er bekreftet.
	 */
	ongoing: boolean;
	/**
	 * Dager fra periodens slutt til siste trendpunkt.
	 *
	 * 0 betyr «fortsatt i bevegelse»; et større tall på en pågående periode betyr at
	 * trenden har stått stille siden. Forskjellen må være synlig: «pågår» om noe som
	 * flatet ut i juli er en påstand om i dag som ikke stemmer.
	 */
	daysSinceEnd: number;
	/** Bare på pågående perioder, og bare når tilbakeslaget er verdt å nevne. */
	retraceKg?: number;
	/** Bare på pågående perioder som er lange nok til at sluttdelen kan sammenlignes. */
	recentPace?: SwingPace;
	/**
	 * Lengste strekk uten en veiing inne i perioden.
	 *
	 * Et tempo regnet over et vindu der halvparten mangler målinger er ikke målt.
	 * Flaten skal kunne kvalifisere tallet framfor å oppgi det bart.
	 */
	longestGapDays: number;
}

type TrendPoint = MetricPoint & { trend: number };

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Trendverdien nærmest en måldag, innenfor toleransen. Nærmeste bakover først. */
function trendNear(
	trendByDay: Map<number, number>,
	targetDay: number,
	tolerance = LOOKUP_TOLERANCE_DAYS
): number | null {
	for (let offset = 0; offset <= tolerance; offset++) {
		const earlier = trendByDay.get(targetDay - offset);
		if (earlier !== undefined) return earlier;
		const later = trendByDay.get(targetDay + offset);
		if (later !== undefined) return later;
	}
	return null;
}

function longestGap(points: TrendPoint[], fromDate: string, toDate: string): number {
	let longest = 0;
	let previous: number | null = null;
	for (const point of points) {
		if (point.date < fromDate || point.date > toDate) continue;
		const current = dayNumber(point.date);
		if (previous !== null) longest = Math.max(longest, current - previous);
		previous = current;
	}
	return longest;
}

/**
 * Tempoet i sluttdelen av en pågående periode, når det avviker fra snittet.
 *
 * Returnerer null når perioden er for kort for sammenligningen, når trendverdien
 * for 30 dager siden mangler, eller når avviket er under støygrensa. «Jevnt
 * tempo» er ikke noe å si — det er standardtilstanden.
 */
function recentPaceOf(
	trendByDay: Map<number, number>,
	swing: { endDate: string; endKg: number; days: number; kgPerMonth: number; direction: SwingDirection }
): SwingPace | null {
	if (swing.days < MIN_DAYS_FOR_PACE_SHIFT) return null;

	const endDay = dayNumber(swing.endDate);
	const earlier = trendNear(trendByDay, endDay - PACE_WINDOW_DAYS);
	if (earlier === null) return null;

	const change = Math.abs(swing.endKg - earlier);
	// Gikk trenden motsatt vei i sluttdelen, er «tempo» det gale ordet — det er et
	// tilbakeslag, og `retraceKg` er stedet det hører.
	const sameDirection = swing.direction === 'ned' ? swing.endKg < earlier : swing.endKg > earlier;
	if (!sameDirection) return null;

	const kgPerMonth = round2((change / PACE_WINDOW_DAYS) * DAYS_PER_MONTH);
	if (Math.abs(kgPerMonth - swing.kgPerMonth) < PACE_SHIFT_KG_PER_MONTH) return null;

	return { days: PACE_WINDOW_DAYS, kgPerMonth, faster: kgPerMonth > swing.kgPerMonth };
}

function build(
	from: TrendPoint,
	to: TrendPoint,
	points: TrendPoint[],
	ongoing: boolean,
	trendByDay: Map<number, number>,
	latest: TrendPoint
): WeightSwing | null {
	const days = dayNumber(to.date) - dayNumber(from.date);
	const change = to.trend - from.trend;
	if (days < MIN_SWING_DAYS || Math.abs(change) < MIN_SWING_KG) return null;

	const direction: SwingDirection = change < 0 ? 'ned' : 'opp';
	const magnitude = Math.abs(change);
	const kgPerMonth = round2((magnitude / days) * DAYS_PER_MONTH);

	const swing: WeightSwing = {
		direction,
		startDate: from.date,
		endDate: to.date,
		startKg: round1(from.trend),
		endKg: round1(to.trend),
		changeKg: round1(magnitude),
		days,
		kgPerWeek: round2((magnitude / days) * 7),
		kgPerMonth,
		ongoing,
		daysSinceEnd: dayNumber(latest.date) - dayNumber(to.date),
		longestGapDays: longestGap(points, from.date, to.date)
	};

	if (ongoing) {
		// Tilbakeslaget måles mot SISTE punkt, ikke mot ytterpunktet perioden
		// slutter på: det er forskjellen mellom «faller fortsatt» og «bunnet ut for
		// tre uker siden», og de to krever ulike ord.
		const retrace = round1(Math.abs(latest.trend - to.trend));
		if (retrace >= MIN_RETRACE_KG) swing.retraceKg = retrace;

		const pace = recentPaceOf(trendByDay, swing);
		if (pace) swing.recentPace = pace;
	}

	return swing;
}

/**
 * Alle perioder i historikken, kronologisk — nedganger og oppganger.
 *
 * `points` er trendserien fra `buildMetricSeries`. Punkter uten trend hoppes
 * over: de første dagene i en historikk har ikke grunnlag for et 7-dagerssnitt.
 *
 * Den siste perioden er `ongoing` når ingen bekreftet vending har avsluttet den.
 */
export function findWeightSwings(points: readonly MetricPoint[]): WeightSwing[] {
	const trend = points.filter((p): p is TrendPoint => p.trend !== null);
	if (trend.length < 2) return [];

	const trendByDay = new Map<number, number>();
	for (const point of trend) trendByDay.set(dayNumber(point.date), point.trend);
	const latest = trend[trend.length - 1];

	const swings: WeightSwing[] = [];
	let direction: SwingDirection | null = null;
	let pivot = trend[0];
	/**
	 * Ytterpunktet: FØRSTE punkt med den beste verdien, og siste punkt med samme
	 * verdi.
	 *
	 * Skillet er der for platåer. Står trenden stille en uke i bunnen, hører den uka
	 * verken til nedgangen som kom dit eller oppgangen som følger — perioden skal
	 * dekke den delen der trenden faktisk beveget seg. Derfor slutter en periode på
	 * `first` (tett slutt, ærlig tempo) og den neste starter på `last`.
	 *
	 * Uten skillet fikk et platå i bunnen ligge inne i nedgangen og trakk tempoet
	 * ned, som er den samme utvannningen faste vinduer lider av.
	 */
	let extremeFirst = trend[0];
	let extremeLast = trend[0];
	// Mens retningen er ukjent følger vi BEGGE ytterpunktene: hvilken vei det
	// første strekket gikk, avgjøres av hvilket av dem som kom sist.
	let low = trend[0];
	let high = trend[0];

	const turn = (next: SwingDirection, point: TrendPoint) => {
		const swing = build(pivot, extremeFirst, trend, false, trendByDay, latest);
		if (swing) swings.push(swing);
		pivot = extremeLast;
		extremeFirst = point;
		extremeLast = point;
		direction = next;
	};

	for (let i = 1; i < trend.length; i++) {
		const point = trend[i];

		if (direction === 'ned') {
			if (point.trend < extremeFirst.trend) {
				extremeFirst = point;
				extremeLast = point;
			} else if (point.trend === extremeFirst.trend) {
				extremeLast = point;
			} else if (point.trend - extremeFirst.trend >= REBOUND_TOLERANCE_KG) {
				turn('opp', point);
			}
			continue;
		}

		if (direction === 'opp') {
			if (point.trend > extremeFirst.trend) {
				extremeFirst = point;
				extremeLast = point;
			} else if (point.trend === extremeFirst.trend) {
				extremeLast = point;
			} else if (extremeFirst.trend - point.trend >= REBOUND_TOLERANCE_KG) {
				turn('ned', point);
			}
			continue;
		}

		if (point.trend < low.trend) low = point;
		if (point.trend > high.trend) high = point;
		if (high.trend - low.trend < REBOUND_TOLERANCE_KG) continue;

		if (high.date > low.date) {
			direction = 'opp';
			pivot = low;
			extremeFirst = high;
		} else {
			direction = 'ned';
			pivot = high;
			extremeFirst = low;
		}
		extremeLast = extremeFirst;
	}

	if (direction !== null) {
		const open = build(pivot, extremeFirst, trend, true, trendByDay, latest);
		if (open) swings.push(open);
	}

	return swings;
}

/** Den pågående perioden, når den finnes og er stor nok til å vises. */
export function currentSwing(swings: readonly WeightSwing[]): WeightSwing | null {
	const last = swings[swings.length - 1];
	return last?.ongoing ? last : null;
}

/**
 * Sann når perioden er den største i sin retning i hele historikken.
 *
 * Sammenligner bare med perioder i SAMME retning: «største bevegelse» på tvers
 * av retning er ikke en påstand noen ber om.
 */
export function isLargestInDirection(swing: WeightSwing, swings: readonly WeightSwing[]): boolean {
	return !swings.some(
		(other) =>
			other !== swing && other.direction === swing.direction && other.changeKg >= swing.changeKg
	);
}

/* ── Ordene ───────────────────────────────────────────
   Setningene bor her, ikke i kortet: de har terskler og forbehold i seg, og et
   kort som setter sammen tall selv flytter reglene til et sted uten tester. */

/**
 * Hvor ferskt et ytterpunkt må være før perioden kalles «pågår».
 *
 * En periode er strukturelt pågående til en vending er bekreftet, og det kan ta
 * uker. «Pågår» om en bunn som ligger tre uker tilbake er en påstand om i dag som
 * ikke stemmer — derfor to felt: `ongoing` (struktur) og `daysSinceEnd` (nå).
 */
export const SWING_FRESH_DAYS = 7;

/** Sann når perioden fortsatt beveger seg, ikke bare mangler en bekreftet vending. */
export function isSwingActive(swing: WeightSwing): boolean {
	return swing.ongoing && swing.daysSinceEnd <= SWING_FRESH_DAYS;
}

/** «Ned 5,9 kg» / «Opp 2,4 kg». */
export function swingHeadline(swing: WeightSwing): string {
	return `${swing.direction === 'ned' ? 'Ned' : 'Opp'} ${kg(swing.changeKg)} kg`;
}

/** «14. apr. – 22. aug. 2026» — året står én gang, på slutten. */
export function swingPeriodText(swing: WeightSwing): string {
	const year = swing.endDate.slice(0, 4);
	const startYear = swing.startDate.slice(0, 4);
	const start =
		startYear === year
			? formatShortDate(swing.startDate)
			: `${formatShortDate(swing.startDate)} ${startYear}`;
	return `${start} – ${formatShortDate(swing.endDate)} ${year}`;
}

/** «1,4 kg i måneden». Måned framfor uke: periodene varer måneder. */
export function swingPaceText(swing: WeightSwing): string {
	return `${kg2(swing.kgPerMonth)} kg i måneden`;
}

/**
 * Den pågående perioden som én setning, til milepælene.
 *
 * Bærer forbeholdene sine selv: et tilbakeslag fra ytterpunktet, et sluttempo som
 * avviker fra snittet, og om perioden er den største i sin retning. Uten dem ville
 * «ned 5,9 kg siden april» stått som en påstand om i dag også når bunnen lå tre
 * uker tilbake.
 */
export function describeCurrentSwing(
	swing: WeightSwing,
	opts: { largestInDirection?: boolean } = {}
): string {
	// Periodens to ender er MOTSATTE ytterpunkter: en nedgang starter på toppen og
	// slutter i bunnen. Å bruke samme ord i begge ender ga «Toppen var 22. august;
	// siden har trenden steget» om en bunn.
	const startAnchor = swing.direction === 'ned' ? 'toppen' : 'bunnen';
	const endAnchor = swing.direction === 'ned' ? 'Bunnen' : 'Toppen';
	const parts = [
		`${swingHeadline(swing)} siden ${startAnchor} ${formatMilestoneDate(swing.startDate)} — ${swingPaceText(swing)} over ${describeSpan(swing.days)}.`
	];

	if (opts.largestInDirection) {
		parts.push(
			swing.direction === 'ned'
				? 'Den største sammenhengende nedgangen vi har målt.'
				: 'Den største sammenhengende oppgangen vi har målt.'
		);
	}

	if (swing.recentPace) {
		parts.push(
			`Siste ${swing.recentPace.days} dager: ${kg2(swing.recentPace.kgPerMonth)} kg i måneden${
				swing.recentPace.faster ? ', altså raskere' : ', altså saktere'
			}.`
		);
	}

	if (swing.retraceKg !== undefined) {
		const turn = swing.direction === 'ned' ? 'steget' : 'falt';
		parts.push(
			`${endAnchor} var ${formatMilestoneDate(swing.endDate)}; siden har trenden ${turn} ${kg(swing.retraceKg)} kg.`
		);
	}

	return parts.join(' ');
}
