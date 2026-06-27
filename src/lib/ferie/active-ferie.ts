/**
 * Pågående ferie: hvilke ferie-temaer som er aktive på en gitt dato eller
 * overlapper et intervall (f.eks. inneværende uke).
 *
 * Brukes server-side for å vise ferie-ikon ved datoen på hjemskjerm og ukeplan,
 * og for å avgjøre om feriedagboka mangler dagens notat. Rene funksjoner, testbare.
 */

import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

/** Ferievinduet — bare datoene trengs for å avgjøre om ferien pågår. */
export interface FerieWindow {
	startDate?: string | null;
	endDate?: string | null;
}

/** Tema med nok felter til å kjenne igjen et ferie-tema og dets vindu. */
export interface FerieThemeLike {
	id: string;
	name: string;
	emoji: string | null;
	ferieProfile?: FerieWindow | null;
}

export interface ActiveFerie {
	id: string;
	name: string;
	emoji: string;
	startDate: string;
	endDate: string;
}

/** Fallback-emoji når ferie-temaet selv ikke har en. */
export const FERIE_FALLBACK_EMOJI = '🏖️';

/** Sann hvis ferievinduet dekker den gitte ISO-datoen (inklusiv begge ender). */
export function isFerieActiveOn(profile: FerieWindow | null | undefined, iso: string): boolean {
	if (!profile?.startDate || !profile?.endDate) return false;
	return profile.startDate <= iso && iso <= profile.endDate;
}

/** Sann hvis ferievinduet overlapper intervallet [fromIso, toIso] (inklusiv). */
export function ferieOverlaps(
	profile: FerieWindow | null | undefined,
	fromIso: string,
	toIso: string
): boolean {
	if (!profile?.startDate || !profile?.endDate) return false;
	return profile.startDate <= toIso && profile.endDate >= fromIso;
}

/**
 * Ferie-temaer (gjenkjent via dashboard-kind) med vindu som overlapper
 * [fromIso, toIso]. Bruk samme dato to ganger for «aktiv akkurat nå».
 */
export function activeFerieThemes<T extends FerieThemeLike>(
	themes: T[],
	fromIso: string,
	toIso: string
): ActiveFerie[] {
	return themes
		.filter((t) => resolveThemeDashboardKind(t.name) === 'ferie')
		.filter((t) => ferieOverlaps(t.ferieProfile, fromIso, toIso))
		.map((t) => ({
			id: t.id,
			name: t.name,
			emoji: t.emoji || FERIE_FALLBACK_EMOJI,
			startDate: t.ferieProfile!.startDate!,
			endDate: t.ferieProfile!.endDate!
		}));
}
