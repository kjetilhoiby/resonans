/**
 * Slepende volum: summen av de siste N dagene, regnet for hver dag.
 *
 * ## Hvorfor et slepende vindu framfor den kumulative kurven
 *
 * `buildCycleSeries` med `mode: 'cumulative'` legger år oppå hverandre og
 * akkumulerer fra 1. januar. Den svarer godt på «hvor ligger jeg an i år mot i
 * fjor», men den **nullstilles hver 1. januar** — så «er jeg i form nå?» er
 * ubesvarlig i februar, og i desember er tallet dominert av ti måneder som ikke
 * sier noe om denne uka.
 *
 * Et slepende vindu har ingen nullstilling. Det svarer på det samme spørsmålet
 * hver dag i året, og det er den kurven man vil se når man lurer på om man
 * bygger eller mister.
 *
 * ## Målet trenger ingen pacing
 *
 * Et kalendermål («200 km i august») må sammenlignes med hvor langt ut i
 * måneden man er, og den regningen er hele `goal-projection.ts`. Et slepende mål
 * («hold 120 km per 30 dager») er direkte sammenlignbart med dagens verdi, hver
 * dag. Det er grunnen til at `levelAgainstReference` er så kort.
 */

import { dayOfYear, type DayValue } from './cycle-series';

/** Ett punkt på den slepende kurven. */
export interface TrailingPoint {
	date: string;
	/**
	 * Summen over vinduet som ENDER på denne datoen, eller `null` når vinduet
	 * strekker seg forbi første måling.
	 *
	 * **`null`, aldri 0, og det er ikke en detalj.** De første N−1 dagene har et
	 * ufullstendig vindu. Med 0 der ville kurven startet på bunnen og klatret i en
	 * måned — en oppbygging som aldri skjedde, og den ser helt ekte ut. Samme
	 * regel som hull i ernæringshistorikken og `MIN_TREND_SAMPLES` i vekttrenden.
	 */
	value: number | null;
}

export interface TrailingSeries {
	windowDays: number;
	points: TrailingPoint[];
	/** Verdien i dag, eller `null` uten et komplett vindu. */
	current: number | null;
	/** Første dato med et komplett vindu, eller `null`. */
	firstCompleteDate: string | null;
}

/** Legger `days` til en dato, som `YYYY-MM-DD`. */
function addDays(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	const at = new Date(Date.UTC(y, m - 1, d + days));
	return at.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = to.split('-').map(Number);
	return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export interface BuildTrailingOptions {
	windowDays: number;
	/** Siste dagen kurven dekker — Oslo-dagen serveren hentet dataene for. */
	today: string;
	/**
	 * Hvor mange dager bakover kurven tegnes. Punkter før dette regnes ikke i det
	 * hele tatt; det er et tak på payloaden, ikke på vinduet.
	 */
	historyDays: number;
}

/**
 * Bygger den slepende kurven fra sparsomme dagsverdier.
 *
 * `days` er sparsom med vilje: `loadRunningHistory` returnerer bare dager med en
 * løpetur. En dag uten løping er en ekte 0 i summen — i motsetning til en dag før
 * målingene begynte, som er ukjent. Det er nettopp det skillet `null` bærer.
 */
export function buildTrailingSeries(
	days: readonly DayValue[],
	options: BuildTrailingOptions
): TrailingSeries {
	const { windowDays, today, historyDays } = options;

	const byDay = new Map<string, number>();
	for (const day of days) {
		byDay.set(day.date, (byDay.get(day.date) ?? 0) + day.value);
	}

	const sorted = [...byDay.keys()].sort();
	const firstMeasured = sorted[0] ?? null;

	const points: TrailingPoint[] = [];
	let current: number | null = null;
	let firstCompleteDate: string | null = null;

	const start = addDays(today, -(historyDays - 1));

	// Rullende sum framfor å summere vinduet på nytt per dag: ni års historikk ×
	// tretti dager er en kvart million oppslag, og dette kalles ved hver sidelast.
	let sum = 0;
	// Fyll opp med dagene som ligger FØR startdatoen men inni dens vindu.
	for (let offset = windowDays - 1; offset >= 1; offset -= 1) {
		sum += byDay.get(addDays(start, -offset)) ?? 0;
	}

	for (let i = 0; i < historyDays; i += 1) {
		const date = addDays(start, i);
		sum += byDay.get(date) ?? 0;

		const windowStart = addDays(date, -(windowDays - 1));
		const complete = firstMeasured !== null && daysBetween(firstMeasured, windowStart) >= 0;
		const value = complete ? Math.round(sum * 10) / 10 : null;
		points.push({ date, value });
		if (value !== null && firstCompleteDate === null) firstCompleteDate = date;
		if (date === today) current = value;

		// Skyv vinduet: trekk fra dagen som faller ut bakerst.
		sum -= byDay.get(windowStart) ?? 0;
	}

	return { windowDays, points, current, firstCompleteDate };
}

// MARK: - Båndet: hva er normalt for meg på denne tida av året

export interface TrailingBand {
	/** Nedre kvartil av historikken for denne tida av året. */
	lower: number;
	/** Øvre kvartil. */
	upper: number;
	/** Medianen — vises som en strek, ikke som en dom. */
	median: number;
	/** Hvor mange historiske observasjoner båndet hviler på. */
	samples: number;
}

/**
 * Hvor mange dager til hver side av samme dato i tidligere år som regnes med.
 *
 * ±10 dager gir opp mot 21 observasjoner per tidligere år, altså nok til en
 * kvartil etter to–tre år. Uten et slikt vindu ville båndet hvilt på ÉN
 * observasjon per år, og en enkelt influensauke i fjor ville definert «normalt».
 */
export const BAND_DAY_WINDOW = 10;

/**
 * Under dette regnes ikke båndet.
 *
 * Et bånd fra fem observasjoner er en gjetning med selvtillit — samme grunn som
 * `MIN_OBSERVATIONS` i sultprediksjonen. Bommer det, slutter brukeren å tro på
 * flaten, og da hjelper det ikke at kurven ved siden av er riktig.
 */
export const MIN_BAND_SAMPLES = 20;

/** Lineært interpolert persentil over en STIGENDE sortert liste. */
function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const at = (sorted.length - 1) * p;
	const low = Math.floor(at);
	const high = Math.ceil(at);
	if (low === high) return sorted[low];
	return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/**
 * Kvartilbåndet for samme tid på året, regnet av TIDLIGERE år.
 *
 * ## Hvorfor kvartiler og ikke min/maks
 *
 * Min/maks er definert av de to verste og beste ukene i historikken, altså av
 * skader og formtopper. Kvartilene sier «halvparten av historikken min ligger
 * her», som er det «normalt for meg» betyr.
 *
 * ## Hvorfor bare tidligere år
 *
 * Inneværende år er det vi måler MOT. Lå det i båndet, ville en tung sesong
 * hevet båndet og skjult seg selv — samme sirkularitet som gjør «ditt eget
 * typiske siste tolv måneder» til en dårlig referanse.
 */
export function trailingBandForDate(
	series: TrailingSeries,
	date: string,
	options: { dayWindow?: number; minSamples?: number } = {}
): TrailingBand | null {
	const dayWindow = options.dayWindow ?? BAND_DAY_WINDOW;
	const minSamples = options.minSamples ?? MIN_BAND_SAMPLES;

	const targetYear = Number(date.slice(0, 4));
	const targetDay = dayOfYear(date);

	const values: number[] = [];
	for (const point of series.points) {
		if (point.value === null) continue;
		const year = Number(point.date.slice(0, 4));
		if (year >= targetYear) continue;
		// NB: skuddår forskyver dag-i-året med én dag etter februar. Samme
		// dokumenterte skjevhet som i `cycle-series`, og den er under
		// slingringsmonnet et ±10-dagers vindu allerede har.
		if (Math.abs(dayOfYear(point.date) - targetDay) > dayWindow) continue;
		values.push(point.value);
	}

	if (values.length < minSamples) return null;

	const sorted = values.sort((a, b) => a - b);
	return {
		lower: Math.round(percentile(sorted, 0.25) * 10) / 10,
		upper: Math.round(percentile(sorted, 0.75) * 10) / 10,
		median: Math.round(percentile(sorted, 0.5) * 10) / 10,
		samples: sorted.length
	};
}

// MARK: - Rampen: bygger jeg, eller mister jeg

export interface TrailingRamp {
	/** Verdien ett helt vindu tilbake. */
	previous: number;
	/** Endring i prosent. Positiv = økende volum. */
	pctChange: number;
	/**
	 * `true` når økningen er brattere enn `RAMP_CAUTION_PCT`.
	 *
	 * **Dette er ikke et helsevarsel, og flaten må ikke tegne det som ett.**
	 * Restitusjonssignalet er akutt/kronisk i formkurven, som er den eneste
	 * dommen som får varselfarge — se `effort-standing.ts`. Dette sier bare at
	 * volumet vokser fort.
	 */
	steep: boolean;
}

/**
 * Over dette regnes rampen som bratt.
 *
 * Ti prosent per måned er en innarbeidet tommelfingerregel, ikke et måltall fra
 * våre egne data — og den er omdiskutert i litteraturen. Den står her fordi en
 * terskel som kan navngis er bedre enn en magefølelse, men tallet skal ikke
 * presenteres som en grense kroppen kjenner.
 */
export const RAMP_CAUTION_PCT = 10;

/**
 * Endringen fra forrige vindu til dette.
 *
 * **Vinduene er ikke-overlappende**, og det er hele grunnen til at
 * sammenligningen betyr noe: dagens slepende 30 dager mot de 30 dagene før dem
 * er to atskilte blokker. Sammenlignet man mot for eksempel to uker tilbake,
 * ville halve datagrunnlaget vært felles, og «endringen» ville vært demmet ned
 * mot null. Samme lærdom som «største nedgang sammenlignes bare med
 * ikke-overlappende vinduer» i `weight-milestones.ts`.
 */
export function trailingRamp(series: TrailingSeries, today: string): TrailingRamp | null {
	if (series.current === null) return null;
	const previousDate = addDays(today, -series.windowDays);
	const previous = series.points.find((p) => p.date === previousDate)?.value ?? null;
	// En previous på 0 er ekte (ingen løping forrige måned), men en prosentvis
	// endring fra null finnes ikke. Da er det nivået som er historien.
	if (previous === null || previous <= 0) return null;

	const pctChange = Math.round(((series.current - previous) / previous) * 1000) / 10;
	return { previous, pctChange, steep: pctChange > RAMP_CAUTION_PCT };
}

// MARK: - Nivået: er jeg i rute

export type LevelStanding = 'over' | 'inside' | 'under';

export interface TrailingLevel {
	standing: LevelStanding;
	/** Hva sammenligningen ble gjort mot — flaten SKAL si dette. */
	reference: 'goal' | 'band';
	/** Avviket i km mot målet eller mot nærmeste båndkant. */
	deltaKm: number;
	/** Andel av målet i prosent. Bare for `reference: 'goal'`. */
	pctOfGoal?: number;
}

/**
 * Ligger jeg i rute?
 *
 * **Målet vinner over båndet når det finnes**, fordi det er brukerens eget svar
 * på spørsmålet. Båndet er hva historikken sier er normalt — nyttig, men det er
 * en beskrivelse, ikke en intensjon.
 *
 * `null` når vi verken har mål eller nok historikk til et bånd. Da er «i rute»
 * ikke et spørsmål vi kan besvare, og flaten skal si det framfor å vise en
 * nøytral pil som ser ut som en dom.
 */
export function levelAgainstReference(
	current: number | null,
	reference: { goalKm?: number | null; band?: TrailingBand | null }
): TrailingLevel | null {
	if (current === null) return null;

	const goal = reference.goalKm;
	if (typeof goal === 'number' && goal > 0) {
		const deltaKm = Math.round((current - goal) * 10) / 10;
		return {
			// Et slepende mål har ingen slingring: du er over eller under det i dag.
			standing: deltaKm >= 0 ? 'over' : 'under',
			reference: 'goal',
			deltaKm,
			pctOfGoal: Math.round((current / goal) * 100)
		};
	}

	const band = reference.band;
	if (band) {
		if (current > band.upper) {
			return {
				standing: 'over',
				reference: 'band',
				deltaKm: Math.round((current - band.upper) * 10) / 10
			};
		}
		if (current < band.lower) {
			return {
				standing: 'under',
				reference: 'band',
				deltaKm: Math.round((current - band.lower) * 10) / 10
			};
		}
		return { standing: 'inside', reference: 'band', deltaKm: 0 };
	}

	return null;
}

/**
 * Setningen flaten og chatten deler.
 *
 * Bor i domenelaget fordi den bærer forbeholdene: hva sammenligningen ble gjort
 * mot, og at en bratt rampe ikke er en dom om kroppen. Fikk modellen bare
 * `standing: 'over'`, ville den funnet sine egne ord — og «over» ble like gjerne
 * «du har overtrent» som «du løper mer enn vanlig». Samme grunn som
 * `planText`/`loadText` i `training-summary.ts`.
 */
export function describeTrailingVolume(input: {
	current: number | null;
	windowDays: number;
	level: TrailingLevel | null;
	ramp: TrailingRamp | null;
	band: TrailingBand | null;
}): string {
	const { current, windowDays, level, ramp, band } = input;
	if (current === null) {
		return `Ikke nok historikk til å regne ${windowDays} dager bakover ennå.`;
	}

	const parts = [`${formatKm(current)} siste ${windowDays} dager.`];

	if (level?.reference === 'goal') {
		const delta = Math.abs(level.deltaKm);
		parts.push(
			level.standing === 'over'
				? `${formatKm(delta)} over målet.`
				: `${formatKm(delta)} under målet.`
		);
	} else if (level?.reference === 'band' && band) {
		if (level.standing === 'inside') {
			parts.push(`Innenfor det vanlige for deg på denne tida (${formatKm(band.lower)}–${formatKm(band.upper)}).`);
		} else if (level.standing === 'over') {
			parts.push(`Over det vanlige for deg på denne tida (${formatKm(band.lower)}–${formatKm(band.upper)}).`);
		} else {
			parts.push(`Under det vanlige for deg på denne tida (${formatKm(band.lower)}–${formatKm(band.upper)}).`);
		}
	} else {
		parts.push('Ingen målverdi satt, og for lite historikk til å si hva som er vanlig for deg her.');
	}

	if (ramp) {
		if (ramp.steep) {
			parts.push(
				`Volumet er ${ramp.pctChange} % opp fra forrige ${windowDays} dager — en rask oppbygging. Om kroppen tåler den, er det formkurven som svarer.`
			);
		} else if (ramp.pctChange <= -RAMP_CAUTION_PCT) {
			parts.push(`Ned ${Math.abs(ramp.pctChange)} % fra forrige ${windowDays} dager.`);
		}
	}

	return parts.join(' ');
}

function formatKm(km: number): string {
	const rounded = Math.round(km * 10) / 10;
	if (rounded === Math.round(rounded)) return `${Math.round(rounded)} km`;
	return `${String(rounded).replace('.', ',')} km`;
}
