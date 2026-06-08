/**
 * Drag-and-drop og langpress-meny for tema-rekkefølge på hjemskjermen.
 *
 * Eksporterer funksjoner som opererer på state-verdier som HomeScreen eier.
 * HomeScreen kaller funksjonene med nødvendige state-referanser.
 */

import type { Theme } from './home-context';

// ── Drag-state interface ───────────────────────────────────────────────

export interface ThemeDragState {
	dragThemeId: string | null;
	dropIndex: number | null;
	isTouchDrag: boolean;
	touchChip: { left: number; width: number; height: number; top: number } | null;
	grabOffsetY: number;
}

export function createThemeDragState(): ThemeDragState {
	return {
		dragThemeId: null,
		dropIndex: null,
		isTouchDrag: false,
		touchChip: null,
		grabOffsetY: 0,
	};
}

export function resetDragState(state: ThemeDragState): void {
	state.dragThemeId = null;
	state.dropIndex = null;
	state.isTouchDrag = false;
	state.touchChip = null;
}

// ── Drop-index beregning ───────────────────────────────────────────────

export function computeDropIndex(
	clientY: number,
	themeListEl: HTMLElement | null,
	dragThemeId: string | null,
	currentDropIndex: number | null
): number {
	if (!themeListEl) return currentDropIndex ?? 0;
	const rows = Array.from(
		themeListEl.querySelectorAll<HTMLElement>('[data-theme-id]')
	);
	let index = 0;
	for (const row of rows) {
		if (row.dataset.themeId === dragThemeId) continue;
		const rect = row.getBoundingClientRect();
		if (rect.height === 0) continue;
		if (clientY > rect.top + rect.height / 2) index++;
		else break;
	}
	return index;
}

// ── Reorder-commit ─────────────────────────────────────────────────────

export function computeReorder(
	themes: Theme[],
	fromId: string,
	dropIdx: number
): Theme[] | null {
	const from = themes.findIndex((t) => t.id === fromId);
	if (from === -1) return null;
	const moved = themes[from];
	const reordered = themes.filter((t) => t.id !== fromId);
	const insertAt = Math.max(0, Math.min(dropIdx, reordered.length));
	reordered.splice(insertAt, 0, moved);
	if (reordered.every((t, i) => t.id === themes[i]?.id)) return null;
	return reordered;
}

export function persistThemeOrder(reordered: Theme[]): void {
	void fetch('/api/tema/reorder', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(reordered.map((t, i) => ({ id: t.id, sortOrder: i })))
	});
}

// ── Tema-handlinger ────────────────────────────────────────────────────

export async function archiveTheme(id: string): Promise<boolean> {
	const res = await fetch(`/api/tema/${id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ archived: true })
	});
	return res.ok;
}

export async function deleteTheme(id: string): Promise<boolean> {
	const res = await fetch(`/api/tema/${id}`, { method: 'DELETE' });
	return res.ok;
}
