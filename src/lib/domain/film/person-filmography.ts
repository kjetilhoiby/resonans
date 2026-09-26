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

// ─── Forslag fra en filmografi ──────────────────────────────────────────────

export interface CuratableEntry {
	tmdbId: number;
	title: string;
	year?: number | null;
	character?: string;
	rating?: number;
	voteCount?: number;
	genreIds?: number[];
}

/** TMDBs sjanger-id for dokumentar. */
const DOCUMENTARY_GENRE_ID = 99;
/**
 * Under dette er snittet et par venners mening. Filtrerer også bort det som ikke
 * er utgitt ennå — en film uten publikum har ingen stemmer.
 */
export const MIN_VOTES = 10;
/**
 * Vekten på ankeret i det bayesianske snittet (IMDbs Top 250-formel). Uten den
 * slår en 8,4 fra tolv stemmer en 7,6 fra tre tusen, og lista blir ei liste over
 * filmer ingen har sett. 50 er lavt nok til at europeisk kunstfilm — der et par
 * hundre stemmer er mye — ikke druknes.
 */
export const PRIOR_VOTES = 50;
/**
 * Ankeret er FAST, omtrent TMDBs katalogsnitt — ikke personens eget snitt. Det
 * ble prøvd og fanget av en test: utliggeren med få stemmer drar personens snitt
 * opp, så ankeret havnet over de solide filmene og «8,9 fra elleve stemmer» ble
 * stående øverst likevel. Et forsiktig anker er poenget, ikke en detalj.
 */
export const PRIOR_MEAN = 6.5;

// «Self», «Herself», «Himself - Host»: talkshow og dokumentarer, ikke en rolle.
const SELF_RE = /^(self|herself|himself|themselves)\b/i;

/**
 * Hva som kan foreslås som en FILM med personen: utgitt, med nok stemmer til at
 * snittet sier noe, og ikke en dokumentar eller en opptreden som seg selv.
 */
export function isCuratable(entry: CuratableEntry, nowYear: number): boolean {
	if (entry.year == null || entry.year > nowYear) return false;
	if ((entry.voteCount ?? 0) < MIN_VOTES || entry.rating == null) return false;
	if (entry.genreIds?.includes(DOCUMENTARY_GENRE_ID)) return false;
	if (entry.character && SELF_RE.test(entry.character.trim())) return false;
	return true;
}

/**
 * Bayesiansk snitt: trekker filmer med få stemmer mot `PRIOR_MEAN`. En film med
 * tusenvis av stemmer beholder i praksis sitt eget snitt.
 */
export function weightedRating(entry: CuratableEntry): number {
	const v = entry.voteCount ?? 0;
	const r = entry.rating ?? PRIOR_MEAN;
	return (v / (v + PRIOR_VOTES)) * r + (PRIOR_VOTES / (v + PRIOR_VOTES)) * PRIOR_MEAN;
}

interface PickOptions {
	/** Filmer som ikke skal foreslås — i praksis det brukeren har sett. */
	exclude?: Set<number>;
	nowYear: number;
}

/**
 * De best vurderte filmene med personen, sett-filmer holdt utenfor. Rangert på
 * vektet snitt, nyeste først ved likhet.
 */
export function pickAcclaimed<T extends CuratableEntry>(
	entries: T[],
	opts: PickOptions & { limit?: number }
): T[] {
	return entries
		.filter((e) => isCuratable(e, opts.nowYear) && !opts.exclude?.has(e.tmdbId))
		.map((e) => ({ e, score: weightedRating(e) }))
		.sort((a, b) => b.score - a.score || (b.e.year ?? 0) - (a.e.year ?? 0))
		.slice(0, opts.limit ?? 10)
		.map(({ e }) => e);
}

/**
 * Et tverrsnitt av karrieren: spennet deles i like lange tidsbolker, og den best
 * vurderte filmen i hver bolk velges. Tomme bolker (et opphold) fylles med de
 * neste beste fra hele karrieren framfor å gi en kortere liste.
 *
 * Spennet regnes av ALLE filmene som kan foreslås, også de brukeren har sett —
 * ellers krymper «karrieren» til det man ikke har sett, og en debut man alt kjenner
 * ville flyttet starten fram.
 */
export function pickCareerSpan<T extends CuratableEntry>(
	entries: T[],
	opts: PickOptions & { slots?: number }
): T[] {
	const slots = opts.slots ?? 6;
	const curatable = entries.filter((e) => isCuratable(e, opts.nowYear));
	const candidates = curatable.filter((e) => !opts.exclude?.has(e.tmdbId));
	const byYear = (a: T, b: T) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title, 'nb');
	if (candidates.length <= slots) return [...candidates].sort(byYear);

	const years = curatable.map((e) => e.year as number);
	const min = Math.min(...years);
	const span = (Math.max(...years) - min + 1) / slots;
	const score = (e: T) => weightedRating(e);

	const picked = new Set<number>();
	const result: T[] = [];
	for (let i = 0; i < slots; i++) {
		const inBucket = candidates.filter((e) => Math.min(slots - 1, Math.floor(((e.year as number) - min) / span)) === i);
		const best = inBucket.sort((a, b) => score(b) - score(a))[0];
		if (best) {
			picked.add(best.tmdbId);
			result.push(best);
		}
	}
	for (const e of [...candidates].sort((a, b) => score(b) - score(a))) {
		if (result.length >= slots) break;
		if (!picked.has(e.tmdbId)) {
			picked.add(e.tmdbId);
			result.push(e);
		}
	}
	return result.sort(byYear);
}

// ─── Personer som går igjen i det brukeren har sett ─────────────────────────

export interface WatchedFilmPeople {
	status: string;
	title: string;
	director?: string | null;
	directorTmdbId?: number | null;
	cast?: Array<{ name: string; personId?: number }> | null;
}

export interface RecurringPerson {
	personId: number | null;
	name: string;
	role: PersonRole;
	/** Antall SETTE filmer personen er med i (regi eller rolle). */
	count: number;
	titles: string[];
}

/**
 * Hvem går igjen i filmene brukeren har SETT? Bare sett — ønskelista sier hva
 * man tror man vil like, ikke hva man har likt.
 *
 * Filmer lagt til før person-id-ene ble lagret har bare navnet, så et navn slås
 * sammen med en id som bærer SAMME navn andre steder i biblioteket. Ellers ville
 * én film med id og én uten telt som to personer med én film hver, og den som
 * går igjen hadde aldri nådd terskelen.
 */
export function recurringPeople(films: WatchedFilmPeople[], minCount = 2): RecurringPerson[] {
	const watched = films.filter((f) => f.status === 'watched');

	const idByName = new Map<string, number>();
	for (const f of watched) {
		if (f.director && f.directorTmdbId != null) idByName.set(normalizeName(f.director), f.directorTmdbId);
		for (const c of f.cast ?? []) if (c.personId != null) idByName.set(normalizeName(c.name), c.personId);
	}

	type Acc = { personId: number | null; name: string; titles: Set<string>; director: number; actor: number };
	const acc = new Map<string, Acc>();
	for (const f of watched) {
		const people: Array<{ name: string; personId?: number | null; role: PersonRole }> = [];
		if (f.director) people.push({ name: f.director, personId: f.directorTmdbId, role: 'director' });
		for (const c of f.cast ?? []) people.push({ name: c.name, personId: c.personId, role: 'actor' });

		const seenInFilm = new Set<string>();
		for (const p of people) {
			const id = p.personId ?? idByName.get(normalizeName(p.name)) ?? null;
			const key = id != null ? `id:${id}` : `name:${normalizeName(p.name)}`;
			const entry = acc.get(key) ?? { personId: id, name: p.name, titles: new Set(), director: 0, actor: 0 };
			entry[p.role]++;
			// Regissør OG rolle i samme film er fortsatt ÉN film.
			if (!seenInFilm.has(key)) {
				seenInFilm.add(key);
				entry.titles.add(f.title);
			}
			acc.set(key, entry);
		}
	}

	return [...acc.values()]
		.filter((a) => a.titles.size >= minCount)
		.map((a) => ({
			personId: a.personId,
			name: a.name,
			role: (a.director >= a.actor ? 'director' : 'actor') as PersonRole,
			count: a.titles.size,
			titles: [...a.titles]
		}))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nb'));
}
