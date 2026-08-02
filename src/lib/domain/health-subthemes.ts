/**
 * Helse-mortemaet og de fem undertemaene.
 *
 * Hierarkiet bæres av `themes.parentTheme`, som er en fritekstkolonne mot
 * forelderens NAVN (ikke en fremmednøkkel) — samme mekanikk som «Hjem» bruker
 * for hus-prosjekter. Denne modulen er eneste kilde for navnene, slik at
 * literalen 'Helse' ikke skrives på nytt rundt i kodebasen, og et framtidig
 * bytte til en id-basert relasjon blir én-fils-arbeid.
 *
 * Klientsikker: ingen db- eller server-import.
 */

import type { DashboardKind } from './theme-dashboard-registry';

export const HEALTH_PARENT_THEME_NAME = 'Helse';

export interface HealthSubtheme {
	/** Temanavnet. Er også nøkkelen `parentTheme` på barna peker tilbake på. */
	name: string;
	emoji: string;
	/** Dashboardtypen `resolveThemeDashboardKind(name)` må gi for dette navnet. */
	kind: DashboardKind;
	description: string;
}

/**
 * Settet er bevisst lukket. Fritekst-undertema ville fått
 * `resolveThemeDashboardKind() === null` og en tom Data-fane, siden
 * dashboardtypen utledes av navnet.
 *
 * Rekkefølgen styrer visningen i undertema-stripen på mordashboardet.
 */
export const HEALTH_SUBTHEMES: readonly HealthSubtheme[] = [
	{
		name: 'Trening',
		emoji: '🏃',
		kind: 'training',
		description: 'Treningsløp, økter, belastning og programmer.'
	},
	{
		name: 'Ernæring',
		emoji: '🥗',
		kind: 'nutrition',
		description: 'Kosthold og energibalanse.'
	},
	{
		name: 'Egenfrekvens',
		emoji: '🧘',
		kind: 'egenfrekvens',
		description: 'Innsjekk på humør, energi og indre tilstand.'
	},
	{
		name: 'Søvn',
		emoji: '😴',
		kind: 'sleep',
		description: 'Søvnlengde, døgnrytme og restitusjon.'
	},
	{
		name: 'Skjermtid',
		emoji: '📱',
		kind: 'screentime',
		description: 'Skjermbruk, scrolling og kveldsarbeid.'
	}
] as const;

export const HEALTH_SUBTHEME_NAMES: readonly string[] = HEALTH_SUBTHEMES.map((s) => s.name);

/** Dashboardtypene som hører til helse-familien, mortemaet inkludert. */
export const HEALTH_FAMILY_KINDS: readonly DashboardKind[] = [
	'health',
	...HEALTH_SUBTHEMES.map((s) => s.kind)
];

export function findHealthSubthemeByKind(kind: DashboardKind | null): HealthSubtheme | null {
	if (!kind) return null;
	return HEALTH_SUBTHEMES.find((s) => s.kind === kind) ?? null;
}

export function isHealthSubthemeName(name: string | null | undefined): boolean {
	if (!name) return false;
	return HEALTH_SUBTHEME_NAMES.includes(name);
}

/**
 * Mortemaer og kategorier vi foreslår for AI-en når den oppretter tema.
 * Rene forslag, ikke en enum: `themes.parentTheme` er fritekst, og en hard
 * liste her ville blokkert kategorier brukeren finner på selv.
 *
 * De tre første eier faktisk undertemaer i koden («Hjem» → hus-prosjekter,
 * «Familie» → ferier, «Helse» → de fem over). Resten er løse kategorier.
 */
export const PARENT_THEME_SUGGESTIONS: readonly string[] = [
	HEALTH_PARENT_THEME_NAME,
	'Hjem',
	'Familie',
	'Samliv',
	'Foreldreliv',
	'Karriere',
	'Økonomi',
	'Personlig utvikling'
];
