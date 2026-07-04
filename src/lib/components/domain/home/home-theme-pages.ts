/**
 * Bygger sveipbare tema-sider for hjemskjermens tema-sone.
 *
 * Standard-temaer chunkes seks og seks — side 1 er de seks prioriterte
 * plassene (sorteringsrekkefølgen fra langpress-lista). Ferie-/reise-temaer
 * og prosjekt-temaer får egne sider til slutt, slik at de aldri opptar de
 * prioriterte plassene.
 */

import type { Theme, ThemeKind } from './home-context';

export const THEMES_PER_PAGE = 6;

export interface ThemePage {
	key: string;
	label: string;
	kind: ThemeKind;
	themes: Theme[];
}

const PAGE_LABELS: Record<ThemeKind, string> = {
	standard: 'Temaer',
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
	for (const kind of ['standard', 'ferie', 'prosjekt'] as const) {
		const rows = themes.filter((t) => themeKindOf(t) === kind);
		for (const [index, pageThemes] of chunk(rows, THEMES_PER_PAGE).entries()) {
			pages.push({
				key: `${kind}:${index}`,
				label: kind === 'standard' && index > 0 ? 'Flere temaer' : PAGE_LABELS[kind],
				kind,
				themes: pageThemes
			});
		}
	}
	return pages;
}

/**
 * Id-en til det siste temaet på de prioriterte plassene (side 1) — brukes som
 * skillelinje i sorteringslista. Null når alle standard-temaer får plass på én side.
 */
export function findPriorityBoundaryId(themes: Theme[]): string | null {
	const standard = themes.filter((t) => themeKindOf(t) === 'standard');
	if (standard.length <= THEMES_PER_PAGE) return null;
	return standard[THEMES_PER_PAGE - 1]?.id ?? null;
}
