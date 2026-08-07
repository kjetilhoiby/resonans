/**
 * Kveldsnudgen som skal konkurrere med telefonen.
 *
 * ## Hvorfor den bærer øvelsen
 *
 * Konkurrenten er ikke mangel på motivasjon, men det som er lettest å gjøre i det
 * øyeblikket man setter seg ned. `repeatableMeals` finnes fordi «favoritter man
 * har glemt å opprette hjelper ingen»; her er det samme: en nudge som sier «husk å
 * skrive» flytter jobben med å finne på noe over på den som er sliten. Øvelsen
 * må ligge i varselet, ferdig formulert, og helst med brukerens egne karakterer i.
 *
 * ## Rangeringen
 *
 * Én nudge, aldri to. Rekkefølgen speiler `decideFuelNudge`:
 *
 * 1. **Prosjektbundet** når et aktivt prosjekt har noe åpent. Flytter manuset
 *    framover, og er den eneste varianten en generisk skriveapp ikke kan lage.
 * 2. **Fri øvelse** når det ikke finnes noe prosjekt å ta tak i, eller når
 *    prosjektbundet har fyrt flere ganger på rad. Variasjon er ikke pynt — en fri
 *    øvelse er ofte veien tilbake inn når man står fast i manuset.
 * 3. **Ingenting** når dagens skriving alt er gjort. En nudge som gratulerer med
 *    noe du nettopp gjorde er støy, og støy blir slått av.
 *
 * ## Hva den ikke gjør
 *
 * Den måler ikke ord. Streaken teller **dager skrevet**, av samme grunn som
 * atferdsmilepælene i vektdomenet: «en motor som bare feirer synkende vekt er stum
 * i alle ukene vekta stiger». En kveld med tung redigering gir negativ
 * ordproduksjon og er likevel en kveld du skrev.
 */

/** Kveldsvinduet. Før dette er det middagstid; etter er det for sent å begynne. */
export const EARLIEST_HOUR = 19;
export const LATEST_HOUR = 22;

/** Etter så mange prosjektbundne på rad tvinges en fri øvelse fram. */
export const MAX_PROJECT_RUN = 3;

export type WritingNudgeKind = 'prosjekt' | 'fri';

export interface NudgeProject {
	id: string;
	title: string;
	/** Titler på karakterer med innhold — råstoffet til de beste øvelsene. */
	characters: string[];
	places: string[];
	/** Deler som er påbegynt men ikke ferdige. */
	openParts: string[];
	/** Deler uten tekst i det hele tatt. */
	emptyParts: string[];
}

export interface WritingNudgeInput {
	osloHour: number;
	/** Har brukeren alt skrevet i dag? Da holder vi kjeft. */
	wroteToday: boolean;
	activeProject: NudgeProject | null;
	/** De siste nudge-variantene, nyeste først. Styrer variasjon. */
	recentKinds: WritingNudgeKind[];
	/** Dager på rad med skriving, til oppmuntringslinja. */
	streakDays: number;
	/** Deterministisk valg blant malene — bruk dagsnummer, ikke tilfeldighet. */
	seed: number;
}

export interface WritingNudge {
	kind: WritingNudgeKind;
	headline: string;
	body: string;
	exercise: string;
	minutes: number;
	projectId: string | null;
}

/** Deterministisk plukk. Tåler tom liste ved å returnere null. */
function pick<T>(items: T[], seed: number): T | null {
	if (items.length === 0) return null;
	// Math.abs fordi et negativt seed ellers gir negativ indeks.
	return items[Math.abs(seed) % items.length];
}

/**
 * Frie øvelser. Bevisst korte og konkrete — en øvelse som krever at man først
 * bestemmer seg for noe er en øvelse man utsetter.
 */
export const FREE_EXERCISES: Array<{ text: string; minutes: number }> = [
	{ text: 'Beskriv rommet du sitter i slik en som frykter noe ville sett det. Ikke nevn frykten.', minutes: 5 },
	{ text: 'Skriv en samtale der begge lyver, og ingen sier det rett ut.', minutes: 5 },
	{ text: 'Ta det siste du sa høyt i dag. Skriv scenen der noen sier det til feil person.', minutes: 5 },
	{ text: 'Skriv ti setninger som alle begynner med «Jeg husker ikke».', minutes: 5 },
	{ text: 'Beskriv en lyd uten å bruke ordet for lyden.', minutes: 4 },
	{ text: 'Skriv en avskjed på under hundre ord. Ingen skal gråte.', minutes: 5 },
	{ text: 'Ta en gjenstand i rommet og skriv dens historie før den kom hit.', minutes: 6 },
	{ text: 'Skriv første avsnitt av en bok du aldri kommer til å skrive.', minutes: 5 }
];

/**
 * Prosjektbundne maler. `{karakter}`, `{sted}` og `{del}` fylles fra prosjektets
 * eget materiale — det er dette som gjør øvelsen umulig for en generisk app.
 */
const PROJECT_TEMPLATES: Array<{
	text: string;
	minutes: number;
	needs: Array<'karakter' | 'sted' | 'del' | 'tomDel'>;
}> = [
	{ text: 'Skriv 200 ord der {karakter} lyver om noe smått.', minutes: 6, needs: ['karakter'] },
	{ text: 'Skriv scenen der {karakter} er alene og ingen ser på.', minutes: 6, needs: ['karakter'] },
	{ text: 'La {karakter} beskrive {sted}. Bare det de legger merke til.', minutes: 6, needs: ['karakter', 'sted'] },
	{ text: 'Skriv den første siden av «{tomDel}» — bare for å komme i gang.', minutes: 7, needs: ['tomDel'] },
	{ text: 'Les «{del}» og skriv den siste replikken om, tre ganger.', minutes: 5, needs: ['del'] },
	{ text: 'Skriv hva {karakter} vil ha i «{del}», i én setning. Så scenen der de ikke får det.', minutes: 7, needs: ['karakter', 'del'] }
];

function fillTemplate(
	template: (typeof PROJECT_TEMPLATES)[number],
	project: NudgeProject,
	seed: number
): { text: string; minutes: number } | null {
	const karakter = pick(project.characters, seed);
	const sted = pick(project.places, seed + 1);
	const del = pick(project.openParts, seed + 2);
	const tomDel = pick(project.emptyParts, seed + 3);

	const values: Record<string, string | null> = { karakter, sted, del, tomDel };
	for (const need of template.needs) {
		if (!values[need]) return null;
	}

	let text = template.text;
	for (const [key, value] of Object.entries(values)) {
		if (value) text = text.replaceAll(`{${key}}`, value);
	}
	return { text, minutes: template.minutes };
}

/** Oppmuntringslinja. Sier noe sant uansett retning — også på dag null. */
export function describeStreak(days: number): string {
	if (days <= 0) return 'Ingen dager på rad akkurat nå. Én kveld er nok til å starte en.';
	if (days === 1) return 'Du skrev i går. To dager på rad er den vanskeligste.';
	return `${days} dager på rad.`;
}

export function decideWritingNudge(input: WritingNudgeInput): WritingNudge | null {
	if (input.osloHour < EARLIEST_HOUR || input.osloHour > LATEST_HOUR) return null;

	// 3. Alt gjort. En nudge om noe du nettopp gjorde er støy.
	if (input.wroteToday) return null;

	const streakLine = describeStreak(input.streakDays);

	// Har prosjektbundet fyrt for mange ganger på rad? Da tvinges variasjon.
	const leadingProjectRun = (() => {
		let run = 0;
		for (const kind of input.recentKinds) {
			if (kind !== 'prosjekt') break;
			run++;
		}
		return run;
	})();

	// 1. Prosjektbundet — den eneste varianten som flytter manuset.
	const project = input.activeProject;
	if (project && leadingProjectRun < MAX_PROJECT_RUN) {
		// Prøv malene i deterministisk rekkefølge fra seed, ta første som har
		// materialet den trenger. Et prosjekt uten karakterer skal ikke gi en
		// øvelse med «{karakter}» stående igjen i teksten.
		for (let i = 0; i < PROJECT_TEMPLATES.length; i++) {
			const template = PROJECT_TEMPLATES[(Math.abs(input.seed) + i) % PROJECT_TEMPLATES.length];
			const filled = fillTemplate(template, project, input.seed);
			if (!filled) continue;
			return {
				kind: 'prosjekt',
				headline: `${filled.minutes} minutter på «${project.title}»?`,
				body: streakLine,
				exercise: filled.text,
				minutes: filled.minutes,
				projectId: project.id
			};
		}
	}

	// 2. Fri øvelse.
	const free = pick(FREE_EXERCISES, input.seed);
	if (!free) return null;
	return {
		kind: 'fri',
		headline: `${free.minutes} minutter skriving?`,
		body: streakLine,
		exercise: free.text,
		minutes: free.minutes,
		projectId: null
	};
}

/**
 * Dager på rad med skriving, regnet bakover fra i dag.
 *
 * Egen funksjon framfor `streak_definitions`, fordi den tabellen krever at
 * brukeren har opprettet en definisjon. Skrivestreaken skal være sann fra første
 * kveld uten oppsett. Vil man ha den som flis blant de andre streakene, lager man
 * en definisjon med `source: { kind: 'sensor_event', dataType: 'writing' }` —
 * hendelsene er de samme.
 *
 * **I dag teller ikke som brudd.** Kvelden er ikke over, og en streak som viser 0
 * hele dagen til man har skrevet ville vært feil hver eneste formiddag.
 */
export function writingStreakDays(dayKeys: string[], todayKey: string): number {
	const days = new Set(dayKeys);
	let streak = 0;
	const cursor = new Date(`${todayKey}T12:00:00Z`);

	if (days.has(todayKey)) streak++;
	cursor.setUTCDate(cursor.getUTCDate() - 1);

	while (days.has(cursor.toISOString().slice(0, 10))) {
		streak++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}

	return streak;
}
