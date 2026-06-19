/**
 * trip-geo.ts
 *
 * Ren logikk for reisens geo-kontekst: hvilket stedssignal som vinner for en gitt
 * dag, og hvordan en avsluttet kjøre-etappe oversettes til et dags-geo.
 *
 * Modellen har tre kilder med ulik presisjon (se changelog 2026-06-19):
 *   observert kjøretur (presise koordinater + tid)  >  deklarert dagsoppgave
 *   («Kjøre til Volda» / «Sted: Volda», geokodet)    >  aktiv overnatting.
 *
 * Det observerte raffinerer det deklarerte. Disse funksjonene er rene (ingen DB,
 * ingen IO) slik at presedensen kan enhetstestes isolert; kallere mater inn
 * kandidater og persisterer resultatet i themes.tripProfile.geoByDay.
 */

export type GeoSource = 'observed' | 'declared' | 'overnight';

export interface DayGeo {
	place?: string;
	lat?: number;
	lon?: number;
	source: GeoSource;
	liveSessionId?: string; // satt når kilden er en observert kjøretur
}

/** Per-dag geo-kart slik det lagres i tripProfile.geoByDay (nøkkel = ISO 'YYYY-MM-DD'). */
export type GeoByDay = Record<string, DayGeo>;

const PRECEDENCE: Record<GeoSource, number> = {
	overnight: 1,
	declared: 2,
	observed: 3
};

/**
 * Skal `candidate` erstatte `current` for en dag? Høyere eller lik presedens
 * vinner — lik presedens betyr at den ferskeste skrivingen vinner (siste etappe
 * den dagen overskriver en tidligere). Ingen eksisterende verdi → alltid skriv.
 */
export function shouldReplaceDayGeo(current: DayGeo | undefined, candidate: DayGeo): boolean {
	if (!current) return true;
	return PRECEDENCE[candidate.source] >= PRECEDENCE[current.source];
}

/** Minimal projeksjon av en live-økt som trengs for å utlede observert dags-geo. */
export interface LiveSessionGeo {
	id: string;
	lastLat?: number | null;
	lastLon?: number | null;
	destLat?: number | null;
	destLon?: number | null;
	destLabel?: string | null;
}

/**
 * Bygg observert dags-geo fra en avsluttet kjøre-etappe. Bruker bilens faktiske
 * sluttposisjon når den finnes, ellers den planlagte destinasjonen. Returnerer
 * null hvis ingen koordinater er kjent (da har vi ikke noe observert å bidra med).
 */
export function buildObservedDayGeo(session: LiveSessionGeo): DayGeo | null {
	const lat = session.lastLat ?? session.destLat ?? null;
	const lon = session.lastLon ?? session.destLon ?? null;
	if (lat == null || lon == null) return null;
	return {
		lat,
		lon,
		place: session.destLabel ?? undefined,
		source: 'observed',
		liveSessionId: session.id
	};
}

/**
 * Slå sammen en geo-kandidat inn i et eksisterende geoByDay-kart for én dag,
 * etter presedens. Returnerer et NYTT kart (muterer ikke input). Hvis kandidaten
 * taper presedens-sammenligningen returneres kartet uendret.
 */
export function applyDayGeo(
	geoByDay: GeoByDay | undefined,
	dateKey: string,
	candidate: DayGeo
): GeoByDay {
	const next: GeoByDay = { ...(geoByDay ?? {}) };
	if (shouldReplaceDayGeo(next[dateKey], candidate)) {
		next[dateKey] = candidate;
	}
	return next;
}

/**
 * ISO-datonøkkel ('YYYY-MM-DD') for et tidspunkt i Oslo-tid. Bruker 'sv'-locale
 * som formaterer nettopp som ISO. Samme idiom som resten av kodebasen
 * (utils/weather.ts). En kjøretur som ankommer 00:30 norsk tid tilskrives den
 * datoen lokalt, ikke UTC-dagen før.
 */
export function osloDayKey(date: Date, timezone = 'Europe/Oslo'): string {
	return date.toLocaleDateString('sv', { timeZone: timezone });
}

/** Minimal projeksjon av et reise-tema for å avgjøre om en dato faller i turvinduet. */
export interface TripCandidate {
	id: string;
	startDate?: string; // ISO 'YYYY-MM-DD'
	endDate?: string;
}

/**
 * Hvilket reise-tema «eier» en gitt dato? Reisen er et temporalt filter, så en
 * kjøretur tilhører turen hvis vinduet [startDate, endDate] dekker datoen — Ekko
 * trenger ikke vite noe om temaet. ISO-datoer sammenlignes leksikografisk.
 *
 * Ved overlapp vinner det smaleste vinduet (den mest spesifikke turen); ellers
 * beholdes kandidatenes rekkefølge. Returnerer null når ingen tur dekker datoen.
 */
export function pickTripForDate(candidates: TripCandidate[], dateKey: string): string | null {
	const matches = candidates.filter(
		(c) => c.startDate && c.endDate && c.startDate <= dateKey && dateKey <= c.endDate
	);
	if (matches.length === 0) return null;
	const windowDays = (c: TripCandidate) =>
		(Date.parse(`${c.endDate}T00:00:00Z`) - Date.parse(`${c.startDate}T00:00:00Z`)) / 86400000;
	matches.sort((a, b) => windowDays(a) - windowDays(b));
	return matches[0].id;
}
