/**
 * tesla-poll-window.ts — når skal Tesla-cronen faktisk polle en bruker?
 *
 * Cron-jobben kjører nå hvert 15. minutt hele døgnet, men i nattevinduet
 * polles bare brukere med en aktiv reise (trip) for sin lokale dato — vanlige
 * netter forblir stille slik at bilen ikke holdes våken og Fleet API-kvoten
 * ikke brennes. Ren logikk uten DB (testbar); cron-endepunktet slår selv opp
 * om brukeren har en trip.
 */

/**
 * Nattevinduet der Tesla-polling normalt står stille: 23:00–05:00 UTC — samme
 * timer som den gamle cron-planen (`*\/15 5-22`) aldri dekket. På deklarerte
 * reisedager polles det også her, slik at tidlig avreise og nattlading fanges.
 */
export function isTeslaQuietWindowUtc(now: Date): boolean {
	const hour = now.getUTCHours();
	return hour >= 23 || hour < 5;
}

/**
 * Skal brukeren synces nå? Utenfor nattevinduet: alltid. I nattevinduet: kun
 * når brukeren har en aktiv trip for sin lokale dato.
 */
export function shouldSyncTeslaUser(now: Date, hasActiveTrip: boolean): boolean {
	return !isTeslaQuietWindowUtc(now) || hasActiveTrip;
}
