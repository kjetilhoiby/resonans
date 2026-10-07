/**
 * Delt live posisjon («Jeg er på vei»): ordene og ankomsttida som delingssiden,
 * forhåndsvisningen (og:title/og:description) og OG-bildet deler.
 *
 * Ren logikk — ingen DB, ingen nettleser. Se
 * docs/changelog/2026-10-07-jeg-er-paa-vei.md.
 *
 * - **Ankomsttida er et KLOKKESLETT, ikke en nedtelling.** «ca. 23 min» er sant i
 *   det øyeblikket noen leser det og feil ti minutter senere; «framme ca. kl.
 *   17:42» står seg i en meldingstråd. Nedtellingen vises som tillegg på siden,
 *   der den regnes på nytt mens man ser på.
 * - **ETA-en er målt da appen sist pinget**, ikke nå. Ekko sender `etaSeconds`
 *   sammen med posisjonen, så ankomsten er `lastPingAt + etaSeconds`. Å legge den
 *   på `now` ville flyttet ankomsten fram i tid for hvert sekund signalet er borte.
 * - **Klokka er Oslo-tid overalt.** Serveren kjører i UTC, og forhåndsvisningen
 *   rendres der; siden må si det samme klokkeslettet som lenka den åpnes fra.
 */

const OSLO_TZ = 'Europe/Oslo';

/** Etter så lenge uten ping sier siden fra at signalet er borte. */
export const STALE_AFTER_SECONDS = 120;

export type LiveShareState = 'waiting' | 'active' | 'arrived' | 'ended';

export interface LiveShareInput {
	destLabel: string | null;
	etaSeconds: number | null;
	lastPingAt: string | Date | null;
	lastLat: number | null;
	lastLon: number | null;
	endedAt: string | Date | null;
	endedReason: string | null;
}

export interface LiveShareSummary {
	state: LiveShareState;
	/** Overskriften, i første person: det er den som deler som snakker. */
	title: string;
	/** Én linje til forhåndsvisningen (og:description) — med ankomsttid når vi har den. */
	description: string;
	/** «17:42» — forventet ankomst mens turen pågår, faktisk ankomst når den er over. */
	arrivalClock: string | null;
	/** Hele minutter til forventet ankomst, regnet mot `now`. Null når turen er over. */
	minutesLeft: number | null;
}

function toDate(value: string | Date | null): Date | null {
	if (value === null) return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** «17:42» i Oslo-tid. */
export function formatOsloClock(date: Date): string {
	return new Intl.DateTimeFormat('nb-NO', {
		timeZone: OSLO_TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	})
		.format(date)
		.replace('.', ':');
}

/**
 * Forventet ankomst: ETA-en slik appen målte den ved siste ping. Null uten ping
 * eller uten ETA (en tur uten mål har ingen ankomst).
 */
export function estimatedArrival(
	etaSeconds: number | null,
	lastPingAt: string | Date | null
): Date | null {
	if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
	const ping = toDate(lastPingAt);
	if (!ping) return null;
	return new Date(ping.getTime() + etaSeconds * 1000);
}

export function liveShareState(input: LiveShareInput): LiveShareState {
	if (input.endedAt) return input.endedReason === 'arrived' ? 'arrived' : 'ended';
	if (input.lastLat === null || input.lastLon === null) return 'waiting';
	return 'active';
}

export function describeLiveShare(input: LiveShareInput, now: Date = new Date()): LiveShareSummary {
	const state = liveShareState(input);
	const dest = input.destLabel?.trim() || null;

	if (state === 'arrived') {
		const ended = toDate(input.endedAt);
		const clock = ended ? formatOsloClock(ended) : null;
		return {
			state,
			title: 'Jeg er framme',
			description: [dest, clock ? `framme kl. ${clock}` : 'framme'].filter(Boolean).join(' · ') || 'Framme',
			arrivalClock: clock,
			minutesLeft: null
		};
	}

	if (state === 'ended') {
		return {
			state,
			title: 'Turen er avsluttet',
			description: 'Posisjonen deles ikke lenger.',
			arrivalClock: null,
			minutesLeft: null
		};
	}

	const arrival = estimatedArrival(input.etaSeconds, input.lastPingAt);
	const clock = arrival ? formatOsloClock(arrival) : null;
	const minutesLeft = arrival
		? Math.max(0, Math.round((arrival.getTime() - now.getTime()) / 60_000))
		: null;

	let description: string;
	if (clock && dest) description = `Til ${dest} · framme ca. kl. ${clock}`;
	else if (clock) description = `Framme ca. kl. ${clock}`;
	else if (dest) description = `På vei til ${dest} · følg turen live`;
	else description = 'Følg turen live';

	return { state, title: 'Jeg er på vei', description, arrivalClock: clock, minutesLeft };
}

/** «om 23 min», «om 1 t 5 min», «snart framme». */
export function formatMinutesLeft(minutes: number | null): string | null {
	if (minutes === null) return null;
	if (minutes < 1) return 'snart framme';
	if (minutes < 60) return `om ${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `om ${h} t` : `om ${h} t ${m} min`;
}

/** «4,2 km», «850 m». Norsk desimalkomma. */
export function formatDistanceLeft(meters: number | null): string | null {
	if (meters === null || !Number.isFinite(meters) || meters < 0) return null;
	if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
	const km = meters / 1000;
	return `${km.toLocaleString('nb-NO', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** «akkurat nå», «40 sek siden», «4 min siden». */
export function formatUpdatedAgo(seconds: number): string {
	if (seconds < 10) return 'akkurat nå';
	if (seconds < 60) return `${seconds} sek siden`;
	return `${Math.round(seconds / 60)} min siden`;
}

/**
 * Del ruta i tilbakelagt og gjenstående ved nærmeste rutepunkt. Posisjonen
 * skjøtes inn i begge, så de to strekene møtes i prikken. Punktene er [lat, lon].
 */
export function splitRouteAtPosition(
	route: ReadonlyArray<readonly [number, number]>,
	lat: number,
	lon: number
): { done: [number, number][]; remaining: [number, number][] } {
	if (route.length < 2) return { done: [], remaining: route.map(([a, b]) => [a, b]) };
	let nearest = 0;
	let best = Infinity;
	for (let i = 0; i < route.length; i++) {
		const dLat = route[i][0] - lat;
		const dLon = route[i][1] - lon;
		const d = dLat * dLat + dLon * dLon;
		if (d < best) {
			best = d;
			nearest = i;
		}
	}
	const here: [number, number] = [lat, lon];
	return {
		done: [...route.slice(0, nearest + 1).map(([a, b]) => [a, b] as [number, number]), here],
		remaining: [here, ...route.slice(nearest + 1).map(([a, b]) => [a, b] as [number, number])]
	};
}

export interface TripProgress {
	/** «16:49» — da delingen startet. */
	startClock: string;
	/** Forventet ankomst mens turen pågår, faktisk ankomst når den er over. */
	endClock: string;
	/** Er `endClock` et anslag («ca.») eller et faktum? */
	endIsEstimate: boolean;
	/** 0–1: hvor langt prikken står mellom start og framme. */
	fraction: number;
}

/**
 * Tidsstripa «startet ─●── framme»: start og ankomst som klokkeslett i hver ende,
 * prikken der turen står.
 *
 * **Stripa er en TIDSakse, og prikken plasseres i tid** — tid gått av forventet
 * totaltid, målt ved siste ping (samme øyeblikk som ETA-en ble regnet). Endene
 * er klokkeslett; en prikk plassert etter distanse ville stått på et klokkeslett
 * den ikke svarer til, og på en tur med motbakke først ville den løpe foran
 * klokka. Distansen står i tallene under stripa.
 *
 * Null uten ankomsttid: en stripe uten høyre ende er bare en strek. En avbrutt
 * tur har ingen ankomst og får heller ingen stripe.
 */
export function tripProgress(
	input: LiveShareInput & { startedAt: string | Date | null }
): TripProgress | null {
	const start = toDate(input.startedAt);
	if (!start) return null;
	const state = liveShareState(input);

	if (state === 'arrived') {
		const end = toDate(input.endedAt);
		if (!end) return null;
		return {
			startClock: formatOsloClock(start),
			endClock: formatOsloClock(end),
			endIsEstimate: false,
			fraction: 1
		};
	}
	if (state !== 'active') return null;

	const ping = toDate(input.lastPingAt);
	const arrival = estimatedArrival(input.etaSeconds, input.lastPingAt);
	if (!ping || !arrival) return null;

	const total = arrival.getTime() - start.getTime();
	const elapsed = ping.getTime() - start.getTime();
	const fraction = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
	return {
		startClock: formatOsloClock(start),
		endClock: formatOsloClock(arrival),
		endIsEstimate: true,
		fraction
	};
}
