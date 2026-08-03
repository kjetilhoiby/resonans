/**
 * Søvnforstyrrelser inn i `sensor_aggregates.metrics.sleepDisturbances`.
 *
 * Egen nøkkel ved siden av `metrics.sleep` (nattlengde) og `metrics.sleepLag`.
 * Forstyrrelsene skal kunne stilles ved siden av nattlengden, ikke blandes inn i
 * den: sju timer søvn der to av dem var våkenliggende er ikke sju gode timer, og
 * det er nettopp det skillet man mister om man bare snitter varighet.
 *
 * Ren funksjon, kalt fra `aggregateWeeklyData`/`Monthly`/`Yearly`.
 *
 * KJENT UNØYAKTIGHET i `nights`: aggregeringen deler hendelser på *tidsstempel*,
 * mens en natt går over midnatt. En natt søndag→mandag har innsovningen i én
 * ISO-uke og oppvåkningen i den neste, så den kan telles i begge ukene. Effekten
 * er ±1 natt ved ukesgrenser.
 *
 * Ikke rettet, fordi en korrekt løsning krever at aggregeringen henter hendelser
 * per *natt*-vindu i stedet for per periode-vindu — altså en endring i kontrakten
 * til hele aggregeringen, for et selvrapportert mykt tall. Flaten er upåvirket:
 * den kaller `groupDisturbancesByNight` rett på hendelsene, så det brukeren ser
 * per natt er alltid riktig.
 */

import { nightKeyForTime, type SleepDisturbanceKind } from './disturbance';

export interface SleepDisturbanceAggregate {
	/** Antall netter med minst én forstyrrelse. */
	nights: number;
	/** Antall «fikk ikke sove»-hendelser. */
	innsovning: number;
	/** Antall «våknet og fikk ikke sove igjen»-hendelser. */
	oppvaakning: number;
	/** Sum av oppgitte minutter våken. Null når ingen oppgav noe. */
	awakeMinutes: number | null;
	/** Antall hendelser i alt. */
	count: number;
}

export interface DisturbanceEventLike {
	dataType?: string | null;
	timestamp: Date | string;
	data?: Record<string, unknown> | null;
}

const KINDS: readonly SleepDisturbanceKind[] = ['innsovning', 'oppvaakning'];

function kindOf(data: Record<string, unknown>): SleepDisturbanceKind | null {
	const raw = data.disturbanceKind;
	return typeof raw === 'string' && (KINDS as readonly string[]).includes(raw)
		? (raw as SleepDisturbanceKind)
		: null;
}

/**
 * Null når perioden ikke har noen forstyrrelser.
 *
 * Bevisst null og ikke et nullfylt objekt — samme regel som `metrics.nutrition`:
 * kallstedet setter feltet bare når det finnes noe, og en periode med
 * `nights: 0` ville sett ut som en uke med data der alt var i orden.
 */
export function computeSleepDisturbanceMetrics(
	events: DisturbanceEventLike[]
): SleepDisturbanceAggregate | null {
	const relevant = events.filter((event) => event.dataType === 'sleep_disturbance');
	if (relevant.length === 0) return null;

	const nights = new Set<string>();
	let innsovning = 0;
	let oppvaakning = 0;
	let minutes = 0;
	let minutesReported = 0;
	let count = 0;

	for (const event of relevant) {
		const data = event.data ?? {};
		const kind = kindOf(data);
		if (!kind) continue;
		count += 1;
		if (kind === 'innsovning') innsovning += 1;
		else oppvaakning += 1;

		const key = nightKeyForTime(event.timestamp instanceof Date ? event.timestamp : String(event.timestamp));
		if (key) nights.add(key);

		const awake = data.awakeMinutes;
		if (typeof awake === 'number' && Number.isFinite(awake) && awake >= 0) {
			minutes += awake;
			minutesReported += 1;
		}
	}

	// Alle radene hadde ukjent kind — da er det ingenting å rapportere.
	if (count === 0) return null;

	return {
		nights: nights.size,
		innsovning,
		oppvaakning,
		awakeMinutes: minutesReported > 0 ? Math.round(minutes) : null,
		count
	};
}
