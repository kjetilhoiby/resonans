/**
 * Bygger sveipbare tema-sider for hjemskjermens tema-sone.
 *
 * De seks øverste temaene i sorteringsrekkefølgen (langpress-lista) utgjør
 * forsiden — uansett kind, så en ferie eller et prosjekt kan prioriteres opp.
 * Resten fordeles på egne sider: standard-temaer chunkes seks og seks,
 * deretter ferie-/reise-temaer og prosjekt-temaer.
 */

import type { Theme, ThemeKind } from './home-context';

export const THEMES_PER_PAGE = 6;

export interface ThemePage {
	key: string;
	label: string;
	kind: ThemeKind | 'prioritert';
	themes: Theme[];
}

const PAGE_LABELS: Record<ThemeKind, string> = {
	standard: 'Flere temaer',
	ferie: 'Ferier & reiser',
	prosjekt: 'Prosjekter'
};

function chunk<T>(rows: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
	return chunks;
}

export function themeKindOf(theme: Theme): ThemeKind {
	return theme.kind ?? 'standard';
}

export function buildThemePages(themes: Theme[]): ThemePage[] {
	const pages: ThemePage[] = [];

	const prioritized = themes.slice(0, THEMES_PER_PAGE);
	if (prioritized.length) {
		pages.push({ key: 'prioritert:0', label: 'Temaer', kind: 'prioritert', themes: prioritized });
	}

	const rest = themes.slice(THEMES_PER_PAGE);
	for (const kind of ['standard', 'ferie', 'prosjekt'] as const) {
		const rows = rest.filter((t) => themeKindOf(t) === kind);
		for (const [index, pageThemes] of chunk(rows, THEMES_PER_PAGE).entries()) {
			pages.push({
				key: `${kind}:${index}`,
				label: PAGE_LABELS[kind],
				kind,
				themes: pageThemes
			});
		}
	}
	return pages;
}

/**
 * Id-en til det siste temaet på de prioriterte plassene (side 1) — brukes som
 * skillelinje i sorteringslista. Null når alle temaer får plass på én side.
 */
export function findPriorityBoundaryId(themes: Theme[]): string | null {
	if (themes.length <= THEMES_PER_PAGE) return null;
	return themes[THEMES_PER_PAGE - 1]?.id ?? null;
}
