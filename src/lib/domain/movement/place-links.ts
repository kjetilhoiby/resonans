/**
 * Kobling av steder på tvers av appene: Akser og Ekko eier hver sine, Resonans kobler.
 * Ren regel; lagringen bor i `$lib/server/movement/place-links-store.ts`.
 *
 * Beslutningen (changelog 2026-10-06, «Hver app eier sine steder»): overlappende steder med
 * samme kategori kobles automatisk; overlapp med ulik kategori eller ulikt navn blir et
 * forslag brukeren bekrefter. Resonans slår aldri sammen og skriver aldri tilbake.
 *
 * ## Ekko har ingen kategori
 *
 * Ekkos `SavedPlace` har bare navn. Kategorien utledes av navnet («Hjem», «Jobben»), og et
 * navn som ikke sier noe gir `unknown` — som da aldri er «samme kategori» som noe. Et likt
 * navn på begge sider kobler også automatisk: «Hytta» og «Hytta» er samme sted.
 *
 * ## Én kobling per sted
 *
 * Akser hadde i oktober 2026 22 automatiske «Nytt sted» innenfor 300 m fra hjemmet. Uten
 * en grense ville Ekkos «Hjem» fått 22 forslag. Hvert sted kobles derfor høyst én gang,
 * grådig etter avstand: nærmeste par først.
 */

import { normalizePlaceText } from './movement-summary';
import type { PlaceCategory } from './places';

export interface LinkablePlace {
	externalId: string;
	name: string;
	category: PlaceCategory;
	named: boolean;
	archived: boolean;
	latitude: number;
	longitude: number;
	radiusMeters: number;
}

export type LinkStatus = 'auto' | 'suggested' | 'confirmed' | 'rejected';

export interface ProposedLink {
	akserId: string;
	ekkoId: string;
	status: 'auto' | 'suggested';
	distanceMeters: number;
}

export interface ExistingLink {
	akserId: string;
	ekkoId: string;
	status: LinkStatus;
}

/** Ordene folk navngir steder med. Første ord som treffer avgjør. */
const NAME_CATEGORIES: Array<[RegExp, PlaceCategory]> = [
	[/\b(hjem|hjemme|huset|leiligheten)\b/, 'home'],
	[/\b(jobb|jobben|kontor|kontoret|arbeid)\b/, 'work'],
	[/\b(gym|treningssenter|treningssenteret|sats|evo|studio)\b/, 'gym'],
	[/\b(butikk|butikken|kiwi|rema|meny|coop|extra|joker)\b/, 'shop'],
	[/\b(stasjon|stasjonen|t ?bane|holdeplass|terminal)\b/, 'transport'],
	[/\b(mor|far|mamma|pappa|svigers|svigermor|svigerfar|besteforeldre|bestemor|bestefar)\b/, 'family']
];

export function inferCategoryFromName(name: string): PlaceCategory {
	const text = normalizePlaceText(name);
	for (const [pattern, category] of NAME_CATEGORIES) {
		if (pattern.test(text)) return category;
	}
	return 'unknown';
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
	const rad = Math.PI / 180;
	const dLat = (b.latitude - a.latitude) * rad;
	const dLon = (b.longitude - a.longitude) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** To sirkler overlapper når avstanden mellom sentrene er under summen av radiene. */
export function overlaps(a: LinkablePlace, b: LinkablePlace): boolean {
	return distanceMeters(a, b) < a.radiusMeters + b.radiusMeters;
}

/** Ekkos kategori, utledet av navnet. Akser har sin egen. */
function effectiveCategory(place: LinkablePlace, app: 'akser' | 'ekko'): PlaceCategory {
	return app === 'ekko' ? inferCategoryFromName(place.name) : place.category;
}

export function isAutoLink(akser: LinkablePlace, ekko: LinkablePlace): boolean {
	if (akser.named && normalizePlaceText(akser.name) === normalizePlaceText(ekko.name)) return true;
	const category = effectiveCategory(ekko, 'ekko');
	return category !== 'unknown' && category === effectiveCategory(akser, 'akser');
}

/**
 * Nye koblinger mellom stedene. `existing` er det som alt er lagret: en bekreftet eller
 * avvist kobling avgjøres aldri på nytt, og et sted med en bekreftet kobling får ikke en
 * til. Automatiske koblinger og forslag regnes ut på nytt hver gang.
 */
export function proposePlaceLinks(
	akserPlaces: readonly LinkablePlace[],
	ekkoPlaces: readonly LinkablePlace[],
	existing: readonly ExistingLink[] = []
): ProposedLink[] {
	const rejected = new Set(existing.filter((l) => l.status === 'rejected').map((l) => `${l.akserId}|${l.ekkoId}`));
	const takenAkser = new Set(existing.filter((l) => l.status === 'confirmed').map((l) => l.akserId));
	const takenEkko = new Set(existing.filter((l) => l.status === 'confirmed').map((l) => l.ekkoId));

	const pairs: Array<{ akser: LinkablePlace; ekko: LinkablePlace; distance: number }> = [];
	for (const ekko of ekkoPlaces) {
		if (ekko.archived || takenEkko.has(ekko.externalId)) continue;
		for (const akser of akserPlaces) {
			if (akser.archived || takenAkser.has(akser.externalId)) continue;
			if (rejected.has(`${akser.externalId}|${ekko.externalId}`)) continue;
			if (!overlaps(akser, ekko)) continue;
			pairs.push({ akser, ekko, distance: distanceMeters(akser, ekko) });
		}
	}

	// Automatiske par først, så nærmeste: et likt navn litt lenger unna slår et
	// navnløst sted rett ved siden av.
	pairs.sort(
		(a, b) => Number(isAutoLink(b.akser, b.ekko)) - Number(isAutoLink(a.akser, a.ekko)) || a.distance - b.distance
	);

	const usedAkser = new Set<string>();
	const usedEkko = new Set<string>();
	const links: ProposedLink[] = [];
	for (const { akser, ekko, distance } of pairs) {
		if (usedAkser.has(akser.externalId) || usedEkko.has(ekko.externalId)) continue;
		usedAkser.add(akser.externalId);
		usedEkko.add(ekko.externalId);
		links.push({
			akserId: akser.externalId,
			ekkoId: ekko.externalId,
			status: isAutoLink(akser, ekko) ? 'auto' : 'suggested',
			distanceMeters: Math.round(distance)
		});
	}
	return links;
}
