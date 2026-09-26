/**
 * Ren logikk for personvisningen i film-temaet: trykk på en skuespiller eller
 * regissør → filmografien, der filmer kan legges på ønskelisten, merkes som
 * sett med terningkast, eller legges i en liste.
 */

export type PersonRole = 'director' | 'actor';

export interface PersonSearchHit {
	personId: number;
	name: string;
	knownForDepartment?: string;
}

const DEPARTMENT_FOR_ROLE: Record<PersonRole, string> = {
	director: 'Directing',
	actor: 'Acting'
};

function normalizeName(s: string): string {
	return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Velg personen et navnesøk skal lande på, for filmer lagret før person-id-en
 * ble tatt vare på. Bare EKSAKTE navnetreff godtas — et nærmeste treff ville
 * vist en annen persons filmer som om de var den man trykket på. Blant flere
 * navnebrødre vinner den som er kjent for rollen man kom fra (en regissør man
 * trykket på under «Regi» er sannsynligvis ikke skuespilleren med samme navn);
 * ellers TMDBs egen rekkefølge, som er popularitet.
 */
export function pickPersonMatch(
	hits: PersonSearchHit[],
	name: string,
	role: PersonRole
): PersonSearchHit | null {
	const wanted = normalizeName(name);
	const exact = hits.filter((h) => normalizeName(h.name) === wanted);
	if (exact.length === 0) return null;
	return exact.find((h) => h.knownForDepartment === DEPARTMENT_FOR_ROLE[role]) ?? exact[0];
}

/**
 * Nyeste først, filmer uten årstall sist. En filmografi blas i for å finne
 * noe å se, og det ferskeste er det man oftest leter etter. Uten årstall er i
 * praksis ikke utgitt ennå — de hører ikke øverst over det man kan se i kveld.
 */
export function sortNewestFirst<T extends { year?: number | null; title: string }>(films: T[]): T[] {
	return [...films].sort((a, b) => {
		const ay = a.year ?? null;
		const by = b.year ?? null;
		if (ay == null && by == null) return a.title.localeCompare(b.title, 'nb');
		if (ay == null) return 1;
		if (by == null) return -1;
		if (ay !== by) return by - ay;
		return a.title.localeCompare(b.title, 'nb');
	});
}
