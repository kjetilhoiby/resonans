/**
 * Samtale-liste state og handlers for hjemskjermen.
 *
 * CRUD-operasjoner, rename, star/archive/delete/move for
 * nylige samtaler som vises i chat-sonen.
 */

import type { RecentConversation, Theme } from './home-context';

// ── State ──────────────────────────────────────────────────────────────

export interface ConversationListState {
	homeConversationList: RecentConversation[];
	homeEditingConversationId: string | null;
	homeEditingTitle: string;
}

export function createConversationListState(initial: RecentConversation[]): ConversationListState {
	return {
		homeConversationList: initial,
		homeEditingConversationId: null,
		homeEditingTitle: '',
	};
}

// ── Operasjoner ────────────────────────────────────────────────────────

export function setConversationStarred(
	state: ConversationListState,
	id: string,
	starred: boolean,
): void {
	state.homeConversationList = state.homeConversationList.map((c) =>
		c.id === id ? { ...c, starred } : c,
	);
}

export function setConversationArchived(
	state: ConversationListState,
	id: string,
	archived: boolean,
): void {
	state.homeConversationList = state.homeConversationList.map((c) =>
		c.id === id ? { ...c, archived } : c,
	);
}

export function removeConversation(state: ConversationListState, id: string): void {
	state.homeConversationList = state.homeConversationList.filter((c) => c.id !== id);
}

export function moveConversationTheme(
	state: ConversationListState,
	id: string,
	themeId: string | null,
	themes: Theme[],
): void {
	const nextTheme = themeId ? themes.find((t) => t.id === themeId) ?? null : null;
	state.homeConversationList = state.homeConversationList.map((c) =>
		c.id === id
			? {
					...c,
					linkedTheme: nextTheme
						? { id: nextTheme.id, name: nextTheme.name, emoji: nextTheme.emoji ?? null }
						: null,
				}
			: c,
	);
}

export function startConversationRename(
	state: ConversationListState,
	id: string,
	currentTitle: string,
): void {
	state.homeEditingConversationId = id;
	state.homeEditingTitle = currentTitle;
}

export function cancelConversationRename(state: ConversationListState): void {
	state.homeEditingConversationId = null;
	state.homeEditingTitle = '';
}

export async function commitConversationRename(
	state: ConversationListState,
	id: string,
): Promise<void> {
	const title = state.homeEditingTitle.trim();
	if (!title) {
		cancelConversationRename(state);
		return;
	}
	state.homeConversationList = state.homeConversationList.map((c) =>
		c.id === id ? { ...c, title } : c,
	);
	state.homeEditingConversationId = null;
	await fetch(`/api/conversations/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ title }),
	});
}

// ── Snooze-meny ────────────────────────────────────────────────────────

export interface SnoozeMenuState {
	snoozeMenuChipId: string | null;
	snoozeMenuLabel: string;
}

export function createSnoozeMenuState(): SnoozeMenuState {
	return {
		snoozeMenuChipId: null,
		snoozeMenuLabel: '',
	};
}

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;

export function startLongPress(
	state: SnoozeMenuState,
	chipId: string,
	label: string,
	_e: PointerEvent,
): void {
	longPressTriggered = false;
	longPressTimer = setTimeout(() => {
		longPressTriggered = true;
		state.snoozeMenuChipId = chipId;
		state.snoozeMenuLabel = label;
		if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
	}, 500);
}

export function cancelLongPress(): void {
	if (longPressTimer !== null) {
		clearTimeout(longPressTimer);
		longPressTimer = null;
	}
}

export function handleChipClick(onclick: () => void): void {
	if (longPressTriggered) {
		longPressTriggered = false;
		return;
	}
	onclick();
}

export function closeSnoozeMenu(state: SnoozeMenuState): void {
	state.snoozeMenuChipId = null;
}

export async function snoozeChip(
	state: SnoozeMenuState,
	scope: 'today' | 'week' | 'forever',
	loadActionCandidates: () => Promise<void>,
): Promise<void> {
	const chipId = state.snoozeMenuChipId;
	closeSnoozeMenu(state);
	if (!chipId) return;
	try {
		await fetch('/api/actions/snooze', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chipId, scope }),
		});
		await loadActionCandidates();
	} catch {
		/* best-effort */
	}
}
