/**
 * Pure utility functions for the FlowSheet component.
 * Extracted from FlowSheet.svelte to keep the component thin.
 */

import type { Flow, FlowStep } from '$lib/flows/types';

// ── Chat message parsing ────────────────────────────────────────────────────

export const PLAN_KLAR_MARKER = '[PLAN_KLAR]';

export interface ParsedChatMessage {
	text: string;
	confirmAction?: string;
}

/**
 * Parse a raw assistant chat message, extracting confirm-actions and reformatting
 * <oppgaver>-blocks as bullet lists.
 */
export function parseChatMessage(raw: string): ParsedChatMessage {
	let text = raw;
	let confirmAction: string | undefined;

	if (text.includes(PLAN_KLAR_MARKER)) {
		text = text.replace(PLAN_KLAR_MARKER, '').trim();
		confirmAction = 'Ja, lagre planen';
	}

	// Reformater <oppgaver>...</oppgaver>-blokker som bullet-liste for visning.
	text = text.replace(/<oppgaver>\s*([\s\S]*?)\s*<\/oppgaver>/gi, (_match, block: string) => {
		const items = block
			.split('\n')
			.map((l) => l.trim().replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
			.filter((l) => l.length > 0);
		if (items.length === 0) return '';
		return items.map((i) => `- ${i}`).join('\n');
	});

	return { text, confirmAction };
}

// ── Step navigation ─────────────────────────────────────────────────────────

/** Find the next non-skipped step index starting after `from`. Returns steps.length if none found. */
export function findNextStepIndex(
	flow: Flow | null,
	from: number,
	data: Record<string, any>
): number {
	const steps = flow?.steps;
	if (!steps) return from + 1;
	let i = from + 1;
	while (i < steps.length) {
		const s = steps[i];
		if (s.skipIf && s.skipIf(data)) i++;
		else return i;
	}
	return steps.length;
}

/** Find the previous non-skipped step index before `from`. Returns -1 if none found. */
export function findPreviousStepIndex(
	flow: Flow | null,
	from: number,
	data: Record<string, any>
): number {
	const steps = flow?.steps;
	if (!steps) return from - 1;
	let i = from - 1;
	while (i >= 0) {
		const s = steps[i];
		if (s.skipIf && s.skipIf(data)) i--;
		else return i;
	}
	return -1;
}

// ── Checklist types & helpers ───────────────────────────────────────────────

export interface FlowChecklistItem {
	id: string;
	text: string;
	source: 'carryover' | 'week' | 'custom' | 'ai';
	selected: boolean;
}

/** Build initial checklist items from context data, deduplicating by normalized text. */
export function buildChecklistItems(
	context: Record<string, any>,
	itemsKey?: string,
	extraItemsKey?: string
): FlowChecklistItem[] {
	const seen = new Set<string>();
	const result: FlowChecklistItem[] = [];

	const primary: string[] = itemsKey ? context[itemsKey] ?? [] : [];
	for (const text of primary) {
		const key = text.trim().toLowerCase();
		if (key && !seen.has(key)) {
			seen.add(key);
			result.push({ id: `primary:${key}`, text: text.trim(), source: 'carryover', selected: true });
		}
	}

	const extra: string[] = extraItemsKey ? context[extraItemsKey] ?? [] : [];
	for (const text of extra) {
		const key = text.trim().toLowerCase();
		if (key && !seen.has(key)) {
			seen.add(key);
			result.push({ id: `extra:${key}`, text: text.trim(), source: 'week', selected: false });
		}
	}

	return result;
}

/** Get the selected task texts from checklist items. */
export function selectedTasks(items: FlowChecklistItem[]): string[] {
	return items.filter((i) => i.selected).map((i) => i.text);
}

// ── Weather types ───────────────────────────────────────────────────────────

export interface WeatherSlot {
	hour: number;
	emoji: string;
	tempC: number | null;
}

export interface WeatherData {
	slots: WeatherSlot[];
	current: { temperatureC: number | null };
}

// ── Rich chat message type ──────────────────────────────────────────────────

import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';

export interface RichChatMsg {
	role: 'user' | 'assistant';
	text: string;
	rawText?: string;
	statusWidget?: WeatherStatusWidget | null;
	confirmAction?: string;
}
