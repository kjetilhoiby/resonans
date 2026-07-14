/**
 * Hvor et talenotat («lagre et notat», Ekko i bilen) skal lande.
 *
 * Reisen/ferien er et temporalt filter — brukeren trenger ikke si hvilket tema
 * notatet hører til. Dekker en reises tripProfile-vindu datoen, eies notatet av
 * reisedagboka (og av ferie-forelderen når reisen arver dagbok derfra, jf.
 * trip-diary-inherit). Uten reise vinner en pågående ferie. Ellers er notatet
 * et frittstående dagsnotat uten tema.
 *
 * Rene funksjoner, testbare — DB-rundene bor i verktøyet (create-note).
 */

import { pickTripForDate } from '$lib/server/trip-geo';
import {
	findParentFerieLink,
	isWithinWindow,
	type DiaryThemeLike
} from '$lib/ferie/trip-diary-inherit';
import { isFerieActiveOn, type FerieWindow } from '$lib/ferie/active-ferie';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

/** Tema med nok felter til å avgjøre reise-/ferie-eierskap for en dato. */
export interface NoteTargetTheme extends DiaryThemeLike {
	ferieProfile?:
		| (FerieWindow & {
				trips?: Array<{
					linkedThemeId?: string;
					startDate?: string;
					endDate?: string;
				}> | null;
		  })
		| null;
}

export interface NoteTarget {
	themeId: string;
	themeName: string;
}

/**
 * Temaet som eier dagens dagbok, eller null når notatet er et frittstående
 * dagsnotat. Reise (smaleste vindu ved overlapp) > ferie-forelder > ferie.
 */
export function resolveNoteTarget(themes: NoteTargetTheme[], dateKey: string): NoteTarget | null {
	const tripId = pickTripForDate(
		themes
			.filter((t) => t.tripProfile?.startDate && t.tripProfile?.endDate)
			.map((t) => ({
				id: t.id,
				startDate: t.tripProfile!.startDate!,
				endDate: t.tripProfile!.endDate!
			})),
		dateKey
	);
	if (tripId) {
		const link = findParentFerieLink(themes, tripId);
		const ownerId = link && isWithinWindow(dateKey, link.window) ? link.parent.id : tripId;
		const owner = themes.find((t) => t.id === ownerId);
		if (owner) return { themeId: owner.id, themeName: owner.name };
	}

	const ferie = themes.find(
		(t) => resolveThemeDashboardKind(t.name) === 'ferie' && isFerieActiveOn(t.ferieProfile, dateKey)
	);
	if (ferie) return { themeId: ferie.id, themeName: ferie.name };

	return null;
}

/**
 * Legg et notat til dagens dagboktekst uten å røre det som står der fra før —
 * eksisterende tekst beholdes, notatet føyes til som eget avsnitt.
 */
export function appendDiaryNote(existing: string | null | undefined, note: string): string {
	const base = existing?.trim() ?? '';
	const addition = note.trim();
	return base ? `${base}\n\n${addition}` : addition;
}
