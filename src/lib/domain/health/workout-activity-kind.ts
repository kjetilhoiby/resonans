/**
 * Aktivitetstypen krydderet snakker om — «løpetur», «elsykkeltur», «sykkeltur».
 *
 * Se `docs/changelog/2026-08-10-krydder-per-aktivitet.md`.
 *
 * **Dette er et tredje grupperingsvokabular, og det er med vilje.** De to som
 * fantes gjør begge det samme feilgrepet for dette formålet:
 *
 * - `workoutSportFamily` folder `e_bike` inn i `cycling`. Riktig for effort- og
 *   distansefiltre — el-sykkel *er* sykling når man teller kilometer — men galt
 *   her: «elsykkeltur nr. 50 i år» krever at el-sykkel er sin egen ting.
 * - `describeWorkoutSportType` folder den samme veien (`e_bike` → «Sykkeløkt»),
 *   og er dessuten en ren visningsstreng. En gruppenøkkel som er en
 *   visningsstreng knekker den dagen noen omformulerer en tittel.
 *
 * Motsatt vei må løpevariantene *slås sammen*: `trail_running` og
 * `indoor_running` er samme streak som `running`. Ingen opplever det som to
 * ulike vaner.
 *
 * Modulen bærer derfor både nøkkelen og de norske ordformene, slik at en regel
 * kan skrive «Løpt 4 dager på rad» og «3. sykkeltur denne uka» uten å bøye selv.
 */

export type WorkoutActivityKind = {
	/** Stabil gruppenøkkel. Aldri vist til brukeren. */
	key: string;
	/** Entall, liten forbokstav: «løpetur». */
	noun: string;
	/** Flertall: «løpeturer». */
	nounPlural: string;
	/**
	 * Perfektum partisipp for streak-setningen: «Løpt 4 dager på rad».
	 * Null for aktiviteter uten et naturlig verb — da faller regelen tilbake
	 * på substantivet framfor å finne på et.
	 */
	verbPast: string | null;
};

const KINDS: Record<string, WorkoutActivityKind> = {
	running: { key: 'running', noun: 'løpetur', nounPlural: 'løpeturer', verbPast: 'Løpt' },
	e_bike: { key: 'e_bike', noun: 'elsykkeltur', nounPlural: 'elsykkelturer', verbPast: 'Syklet elsykkel' },
	cycling: { key: 'cycling', noun: 'sykkeltur', nounPlural: 'sykkelturer', verbPast: 'Syklet' },
	walking: { key: 'walking', noun: 'gåtur', nounPlural: 'gåturer', verbPast: 'Gått' },
	hiking: { key: 'hiking', noun: 'fjelltur', nounPlural: 'fjellturer', verbPast: 'Gått på tur' },
	swimming: { key: 'swimming', noun: 'svømmeøkt', nounPlural: 'svømmeøkter', verbPast: 'Svømt' },
	yoga: { key: 'yoga', noun: 'yogaøkt', nounPlural: 'yogaøkter', verbPast: null },
	strength: { key: 'strength', noun: 'styrkeøkt', nounPlural: 'styrkeøkter', verbPast: null },
	hill: { key: 'hill', noun: 'bakkeøkt', nounPlural: 'bakkeøkter', verbPast: null }
};

const FALLBACK: WorkoutActivityKind = {
	key: 'workout',
	noun: 'treningsøkt',
	nounPlural: 'treningsøkter',
	verbPast: null
};

export function workoutActivityKind(sportType: string | null | undefined): WorkoutActivityKind {
	const value = (sportType ?? '').trim().toLowerCase();
	if (value.length === 0) return FALLBACK;

	// El-sykkel FØRST: den inneholder «bik»/«cycl» i flere skrivemåter, og skal
	// ikke fanges av sykkel-regelen under.
	if (value === 'e_bike' || value.includes('ebik') || value.includes('e-bik') || value.includes('ebike')) {
		return KINDS.e_bike;
	}
	if (value.includes('running') || value === 'run' || value === 'løp') return KINDS.running;
	if (value.includes('cycling') || value.includes('bike') || value.includes('bicycl')) return KINDS.cycling;
	if (value === 'hiking' || value.includes('hike')) return KINDS.hiking;
	if (value.includes('walking') || value === 'walk') return KINDS.walking;
	if (value.includes('swimming') || value === 'swim') return KINDS.swimming;
	if (value.includes('yoga')) return KINDS.yoga;
	if (value.includes('strength') || value.includes('styrke')) return KINDS.strength;
	if (value === 'hill') return KINDS.hill;

	// Ukjent type er sin egen gruppe, med generiske ord. Da blir krydderet
	// «3. treningsøkt denne uka» framfor å slå den sammen med noe den ikke er.
	return { ...FALLBACK, key: value };
}
