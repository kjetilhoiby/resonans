/**
 * Reisedagbok arver fra feriedagboka.
 *
 * En reise forfremmet fra en ferie (ferieProfile.trips[].linkedThemeId) deler
 * dagbok med ferien: feriedagbokas notater vises i reisedagboka for datoer i
 * reisevinduet, og lagring fra reisedagboka skrives tilbake til ferie-temaet.
 * Slik finnes det én dagbok per dag — ferien eier den, reisen er et vindu.
 *
 * Fletting skjer felt-for-felt fordi Ekko auto-seeder rader på reise-temaet
 * (sted/vær med tom tekst): ferien vinner ved konflikt, reisens egne felter
 * fyller hull. Rene funksjoner, testbare.
 */

export interface DiaryWindow {
	startDate?: string | null;
	endDate?: string | null;
}

/** Tema med nok felter til å finne ferie→reise-koblingen og reisevinduet. */
export interface DiaryThemeLike {
	id: string;
	name: string;
	tripProfile?: DiaryWindow | null;
	ferieProfile?: {
		trips?: Array<{
			linkedThemeId?: string;
			startDate?: string;
			endDate?: string;
		}> | null;
	} | null;
}

export interface DiaryEntryFields {
	date: string;
	content: string;
	place?: string;
	weather?: unknown;
	images?: string[];
	geo?: unknown;
}

export interface MergedDiaryEntry extends DiaryEntryFields {
	/** Sann når notatet (helt eller delvis) kommer fra feriedagboka. */
	inherited?: boolean;
}

export interface ParentFerieLink {
	/** Ferie-temaet som eier dagboka. */
	parent: DiaryThemeLike;
	/** Datovinduet arven gjelder for (reisens vindu). */
	window: { startDate: string; endDate: string };
}

/**
 * Finner ferie-temaet en reise hører til, via linkedThemeId i feriens
 * reiseblokker. Vinduet tas fra reisens tripProfile, med reiseblokkas datoer
 * som fallback. Uten vindu kan ikke arven avgrenses → null.
 */
export function findParentFerieLink(
	themes: DiaryThemeLike[],
	tripThemeId: string
): ParentFerieLink | null {
	const self = themes.find((t) => t.id === tripThemeId);
	for (const theme of themes) {
		if (theme.id === tripThemeId) continue;
		const block = theme.ferieProfile?.trips?.find((t) => t.linkedThemeId === tripThemeId);
		if (!block) continue;
		const startDate = self?.tripProfile?.startDate ?? block.startDate;
		const endDate = self?.tripProfile?.endDate ?? block.endDate;
		if (!startDate || !endDate) return null;
		return { parent: theme, window: { startDate, endDate } };
	}
	return null;
}

/** Sann hvis ISO-datoen ligger i vinduet (inklusiv begge ender). */
export function isWithinWindow(date: string, window: DiaryWindow): boolean {
	if (!window.startDate || !window.endDate) return false;
	return window.startDate <= date && date <= window.endDate;
}

/** Felt-for-felt-fletting av én dag: ferien vinner, reisen fyller hull. */
export function mergeDiaryDay(
	parent: DiaryEntryFields | undefined,
	own: DiaryEntryFields | undefined
): MergedDiaryEntry | undefined {
	if (!parent) return own;
	if (!own) return { ...parent, inherited: true };
	return {
		date: parent.date,
		content: parent.content || own.content,
		place: parent.place ?? own.place,
		weather: parent.weather ?? own.weather,
		images: parent.images && parent.images.length > 0 ? parent.images : own.images,
		geo: parent.geo ?? own.geo,
		inherited: true
	};
}

/**
 * Fletter reisens egne notater med feriens notater innenfor vinduet.
 * Feriens notater utenfor vinduet ignoreres. Sortert på dato.
 */
export function mergeInheritedDiary(
	own: DiaryEntryFields[],
	parentEntries: DiaryEntryFields[],
	window: DiaryWindow
): MergedDiaryEntry[] {
	const parentInWindow = new Map(
		parentEntries.filter((e) => isWithinWindow(e.date, window)).map((e) => [e.date, e])
	);
	const ownByDate = new Map(own.map((e) => [e.date, e]));
	const dates = [...new Set([...ownByDate.keys(), ...parentInWindow.keys()])].sort();
	return dates
		.map((date) => mergeDiaryDay(parentInWindow.get(date), ownByDate.get(date)))
		.filter((e): e is MergedDiaryEntry => e !== undefined);
}
