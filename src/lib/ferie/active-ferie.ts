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

// ── Reise-/ferie-kontekst for chat ──────────────────────────────────────────

export interface FerieTrip {
	label: string;
	place?: string;
	startDate?: string;
	endDate?: string;
	participants?: string[];
}

export interface FerieContextTheme {
	name: string;
	ferieProfile?: {
		startDate?: string;
		endDate?: string;
		note?: string;
		trips?: FerieTrip[];
	} | null;
}

export type TripPhase = 'ongoing' | 'upcoming' | 'past' | 'undated';

/** Hvor en reise ligger i forhold til `todayIso` (inklusiv begge ender). */
export function tripPhase(trip: FerieTrip, todayIso: string): TripPhase {
	const { startDate, endDate } = trip;
	if (!startDate && !endDate) return 'undated';
	const start = startDate ?? endDate!;
	const end = endDate ?? startDate!;
	if (end < todayIso) return 'past';
	if (start > todayIso) return 'upcoming';
	return 'ongoing';
}

function formatIsoShort(iso: string): string {
	const d = new Date(iso + 'T12:00:00');
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(d);
}

/** «5.–7. juli» / «30. juni–2. juli» / «5. juli» / «fra 5. juli» / «til 7. juli». */
export function formatTripDates(trip: FerieTrip): string {
	const { startDate, endDate } = trip;
	if (startDate && endDate) {
		return startDate === endDate
			? formatIsoShort(startDate)
			: `${formatIsoShort(startDate)}–${formatIsoShort(endDate)}`;
	}
	if (startDate) return `fra ${formatIsoShort(startDate)}`;
	if (endDate) return `til ${formatIsoShort(endDate)}`;
	return '';
}

function formatTripLine(trip: FerieTrip): string {
	const parts: string[] = [];
	parts.push(trip.place ? `${trip.label} (${trip.place})` : trip.label);
	if (trip.participants && trip.participants.length > 0) {
		parts.push(`– ${trip.participants.join(', ')}`);
	}
	const dates = formatTripDates(trip);
	if (dates) parts.push(`[${dates}]`);
	return `- ${parts.join(' ')}`;
}

/**
 * Bygger et kontekst-avsnitt om pågående ferie og dens reiser (pågående + kommende),
 * slik at chatten vet hvor brukeren er og hvem som er med — uten å spørre.
 * Ren og testbar. Returnerer tom streng hvis ingen ferie er aktiv i dag.
 */
export function buildFerieContextBlock(themes: FerieContextTheme[], todayIso: string): string {
	const active = themes.filter(
		(t) => resolveThemeDashboardKind(t.name) === 'ferie' && isFerieActiveOn(t.ferieProfile, todayIso)
	);
	if (active.length === 0) return '';

	const blocks: string[] = [];
	for (const theme of active) {
		const profile = theme.ferieProfile!;
		const header = `Pågående ferie: «${theme.name}»${
			profile.startDate && profile.endDate
				? ` (${formatIsoShort(profile.startDate)}–${formatIsoShort(profile.endDate)})`
				: ''
		}.${profile.note ? ` ${profile.note}` : ''}`;

		const trips = profile.trips ?? [];
		const ongoing = trips.filter((t) => tripPhase(t, todayIso) === 'ongoing');
		const upcoming = trips
			.filter((t) => tripPhase(t, todayIso) === 'upcoming')
			.sort((a, b) => (a.startDate ?? '') < (b.startDate ?? '') ? -1 : 1);

		const lines = [header];
		if (ongoing.length > 0) {
			lines.push('Reiser som pågår nå:');
			lines.push(...ongoing.map(formatTripLine));
		}
		if (upcoming.length > 0) {
			lines.push('Kommende reiser:');
			lines.push(...upcoming.map(formatTripLine));
		}
		blocks.push(lines.join('\n'));
	}

	return `\n\n## Ferie akkurat nå\n(Bruk dette til å forstå hvor brukeren er og hvem som er med på hvilken reise, uten å spørre.)\n${blocks.join('\n\n')}`;
}
