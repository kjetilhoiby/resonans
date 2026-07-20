/**
 * Prosjekttyper for hjem-prosjekter (undertemaer av 'Hjem').
 *
 * Et hjem-prosjekt er et tema med `parentTheme='Hjem'` og et `projectProfile`.
 * `projectProfile.kind` avgjør hvilke faner prosjektet får: et bygg-prosjekt får
 * kappliste (materialkalkulator), mens et kommunikasjonsprosjekt heller får en
 * kontaktliste og purre-nudges. Mangler kind → 'bygg' (bakoverkompatibelt: eldre
 * prosjekter oppførte seg som bygg-prosjekter med kappliste).
 *
 * Fanene her er prosjekt-spesifikke (utover 'chat' og 'filer' som alle får):
 *   - 'oppgaver'  — checklist_items knyttet til temaet
 *   - 'kapp'      — kapplister (materialkalkulator)
 *   - 'kontakter' — project_contacts (hvem skal kontaktes / purres)
 */

export type ProjectKind = 'bygg' | 'kommunikasjon' | 'arrangement' | 'innkjop' | 'generell';

/** Prosjekt-spesifikke faner (chat + filer legges på av tab-resolveren). */
export type ProjectTab = 'oppgaver' | 'kapp' | 'kontakter';

export interface ProjectKindDef {
	key: ProjectKind;
	label: string;
	emoji: string;
	/** Kort forklaring i type-velgeren. */
	hint: string;
	/** Prosjekt-spesifikke faner, i rekkefølge (uten 'chat'/'filer'). */
	tabs: ProjectTab[];
}

export const PROJECT_KINDS: ProjectKindDef[] = [
	{
		key: 'bygg',
		label: 'Bygg / oppussing',
		emoji: '🔨',
		hint: 'Oppgaver, kappliste og materialkalkulator.',
		tabs: ['oppgaver', 'kapp']
	},
	{
		key: 'kommunikasjon',
		label: 'Kommunikasjon',
		emoji: '📞',
		hint: 'Samle kontaktinfo, følg opp og purre. Ingen kappliste.',
		tabs: ['oppgaver', 'kontakter']
	},
	{
		key: 'arrangement',
		label: 'Arrangement',
		emoji: '🎉',
		hint: 'Gjester og leverandører å kontakte, pluss oppgaver.',
		tabs: ['oppgaver', 'kontakter']
	},
	{
		key: 'innkjop',
		label: 'Innkjøp',
		emoji: '🛒',
		hint: 'Handleoppgaver og kappliste for materialer.',
		tabs: ['oppgaver', 'kapp']
	},
	{
		key: 'generell',
		label: 'Generelt',
		emoji: '📋',
		hint: 'Bare oppgaver og filer.',
		tabs: ['oppgaver']
	}
];

export const DEFAULT_PROJECT_KIND: ProjectKind = 'bygg';

const KIND_BY_KEY = new Map<string, ProjectKindDef>(PROJECT_KINDS.map((k) => [k.key, k]));

/** Er strengen en gyldig prosjekttype-nøkkel? */
export function isProjectKind(value: unknown): value is ProjectKind {
	return typeof value === 'string' && KIND_BY_KEY.has(value);
}

/**
 * Slår opp prosjekttype-definisjonen for en `projectProfile` (eller rå kind-streng).
 * Faller tilbake til 'bygg' når kind mangler eller er ukjent.
 */
export function resolveProjectKind(
	profileOrKind: { kind?: string | null } | string | null | undefined
): ProjectKindDef {
	const kind = typeof profileOrKind === 'string' ? profileOrKind : profileOrKind?.kind;
	return (kind && KIND_BY_KEY.get(kind)) || KIND_BY_KEY.get(DEFAULT_PROJECT_KIND)!;
}

/**
 * Fullstendig, ordnet fane-liste for et prosjekt: alltid 'chat' først og 'filer' sist,
 * med de prosjekt-spesifikke fanene imellom (styrt av typen).
 */
export function projectTabsForKind(
	profileOrKind: { kind?: string | null } | string | null | undefined
): Array<'chat' | ProjectTab | 'filer'> {
	const def = resolveProjectKind(profileOrKind);
	return ['chat', ...def.tabs, 'filer'];
}

/** Har prosjektet en kontaktliste-fane? */
export function projectHasContacts(
	profileOrKind: { kind?: string | null } | string | null | undefined
): boolean {
	return resolveProjectKind(profileOrKind).tabs.includes('kontakter');
}
