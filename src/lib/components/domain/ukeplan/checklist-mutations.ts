/**
 * checklist-mutations.ts — Checklist mutation functions for ukeplan.
 *
 * All side-effecting operations that create/update/delete/reorder checklist items,
 * extracted from the +page.svelte to keep it a slim composition shell.
 */

import { invalidateAll } from '$app/navigation';
import { findRepeatGroup } from './checklist-ops';
import { detectAutoCheck, applyAutoCheck, type AutoCheckPrompt } from './autocheck';
import type {
	SaveState, ChecklistItem, WeekChecklist, DayChecklist, EditingItem
} from './types';

// ── Callback types ──

export type SetSaveState = (key: string, state: SaveState) => void;
export type FlashSaved = (key: string) => void;
export type UpdateChecklistById = (
	checklistId: string,
	updater: (checklist: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist
) => void;
export type GetChecklistById = (checklistId: string) => DayChecklist | WeekChecklist | null;
export type SaveKeyForChecklist = (checklistId: string) => string;

export interface MutationDeps {
	setSaveState: SetSaveState;
	flashSaved: FlashSaved;
	updateChecklistById: UpdateChecklistById;
	getChecklistById: GetChecklistById;
	saveKeyForChecklist: SaveKeyForChecklist;
}

// ── Create ──

export async function createChecklistItem(
	deps: MutationDeps,
	checklistId: string,
	text: string,
	count: number,
	weekChecklistId: string | null
): Promise<AutoCheckPrompt | null> {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const checklist = deps.getChecklistById(checklistId);
	if (!checklist) return null;
	const key = deps.saveKeyForChecklist(checklistId);
	deps.setSaveState(key, 'saving');
	const response = await fetch(`/api/checklists/${checklistId}/items`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: trimmed, count, sortOrder: checklist.items.length })
	});
	if (!response.ok) { deps.setSaveState(key, 'idle'); return null; }
	const created = await response.json() as ChecklistItem[];
	deps.updateChecklistById(checklistId, (current) => ({
		...current,
		items: [...current.items, ...created]
	}));
	deps.flashSaved(key);
	return detectAutoCheck(checklistId, created, weekChecklistId);
}

// ── Toggle ──

export async function toggleChecklistItem(
	deps: MutationDeps,
	checklistId: string,
	itemId: string,
	checked: boolean
): Promise<void> {
	const key = deps.saveKeyForChecklist(checklistId);
	deps.updateChecklistById(checklistId, (current) => ({
		...current,
		items: current.items.map((item) => item.id === itemId ? { ...item, checked } : item)
	}));
	deps.setSaveState(key, 'saving');
	const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ checked })
	});
	if (!response.ok) {
		deps.updateChecklistById(checklistId, (current) => ({
			...current,
			items: current.items.map((item) => item.id === itemId ? { ...item, checked: !checked } : item)
		}));
		deps.setSaveState(key, 'idle');
		return;
	}
	deps.flashSaved(key);
}

// ── Save edited ──

export async function saveEditedItem(
	deps: MutationDeps,
	item: EditingItem,
	deleteItem: (checklistId: string, itemId: string) => Promise<void>
): Promise<void> {
	const trimmed = item.text.trim();
	const checklist = deps.getChecklistById(item.checklistId);
	if (!checklist) return;
	if (!trimmed) {
		await deleteItem(item.checklistId, item.itemId);
		return;
	}
	const existing = checklist.items.find((i) => i.id === item.itemId);
	if (!existing || existing.text === trimmed) return;
	const key = deps.saveKeyForChecklist(item.checklistId);
	deps.updateChecklistById(item.checklistId, (current) => ({
		...current,
		items: current.items.map((i) => i.id === item.itemId ? { ...i, text: trimmed } : i)
	}));
	deps.setSaveState(key, 'saving');
	const response = await fetch(`/api/checklists/${item.checklistId}/items/${item.itemId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: trimmed })
	});
	if (!response.ok) {
		deps.updateChecklistById(item.checklistId, (current) => ({
			...current,
			items: current.items.map((i) => i.id === item.itemId ? { ...i, text: existing.text } : i)
		}));
		deps.setSaveState(key, 'idle');
		return;
	}
	deps.flashSaved(key);
}

// ── Delete ──

export async function deleteChecklistItem(
	deps: MutationDeps,
	checklistId: string,
	itemId: string
): Promise<void> {
	const checklist = deps.getChecklistById(checklistId);
	if (!checklist) return;
	const ids = findRepeatGroup(checklist.items, itemId);
	const idSet = new Set(ids);
	const previousItems = checklist.items;
	const nextItems = previousItems.filter((item) => !idSet.has(item.id));
	const key = deps.saveKeyForChecklist(checklistId);
	deps.updateChecklistById(checklistId, (current) => ({ ...current, items: nextItems }));
	deps.setSaveState(key, 'saving');
	const responses = await Promise.all(
		[...idSet].map((id) => fetch(`/api/checklists/${checklistId}/items/${id}`, { method: 'DELETE' }))
	);
	if (responses.some((r) => !r.ok)) {
		deps.updateChecklistById(checklistId, (current) => ({ ...current, items: previousItems }));
		deps.setSaveState(key, 'idle');
		return;
	}
	deps.flashSaved(key);
}

// ── Reorder ──

export async function reorderChecklistItems(
	deps: MutationDeps,
	checklistId: string,
	sourceId: string,
	targetId: string
): Promise<void> {
	if (sourceId === targetId) return;
	const checklist = deps.getChecklistById(checklistId);
	if (!checklist) return;
	const sourceIndex = checklist.items.findIndex((item) => item.id === sourceId);
	const targetIndex = checklist.items.findIndex((item) => item.id === targetId);
	if (sourceIndex === -1 || targetIndex === -1) return;
	const reordered = [...checklist.items];
	const [moved] = reordered.splice(sourceIndex, 1);
	reordered.splice(targetIndex, 0, moved);
	deps.updateChecklistById(checklistId, (current) => ({ ...current, items: reordered }));
	const key = deps.saveKeyForChecklist(checklistId);
	deps.setSaveState(key, 'saving');
	const results = await Promise.all(
		reordered.map((item, index) =>
			fetch(`/api/checklists/${checklistId}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sortOrder: index })
			})
		)
	);
	if (results.some((result) => !result.ok)) {
		deps.updateChecklistById(checklistId, (current) => ({ ...current, items: checklist.items }));
		deps.setSaveState(key, 'idle');
		return;
	}
	deps.flashSaved(key);
}

// ── Skip / Unskip ──

export async function setItemSkipped(
	deps: MutationDeps,
	checklistId: string,
	itemId: string,
	skipped: boolean
): Promise<void> {
	deps.updateChecklistById(checklistId, (current) => ({
		...current,
		items: current.items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: skipped ? new Date().toISOString() : null, snoozedToDate: skipped ? i.snoozedToDate : null, checked: skipped ? false : i.checked }
				: i
		)
	}));
	const key = deps.saveKeyForChecklist(checklistId);
	deps.setSaveState(key, 'saving');
	const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ skipped })
	});
	if (!res.ok) { deps.setSaveState(key, 'idle'); await invalidateAll(); return; }
	deps.flashSaved(key);
}

// ── Snooze ──

export async function snoozeItem(
	deps: MutationDeps,
	checklistId: string,
	itemId: string,
	targetDate: string
): Promise<void> {
	deps.updateChecklistById(checklistId, (current) => ({
		...current,
		items: current.items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: new Date().toISOString(), snoozedToDate: targetDate, checked: false }
				: i
		)
	}));
	const key = deps.saveKeyForChecklist(checklistId);
	deps.setSaveState(key, 'saving');
	const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}/snooze`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetDate })
	});
	if (!res.ok) { deps.setSaveState(key, 'idle'); await invalidateAll(); return; }
	deps.flashSaved(key);
	await invalidateAll();
}

// ── Add child item ──

export async function addChildItem(
	deps: MutationDeps,
	checklistId: string,
	parentId: string,
	text: string
): Promise<void> {
	const checklist = deps.getChecklistById(checklistId);
	if (!checklist) return;
	const response = await fetch(`/api/checklists/${checklistId}/items`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, sortOrder: checklist.items.length, parentId })
	});
	if (!response.ok) return;
	const created = await response.json() as ChecklistItem[];
	deps.updateChecklistById(checklistId, (current) => ({
		...current,
		items: [...current.items, ...created]
	}));
}

// ── Append checklist items (used by day close) ──

export async function appendChecklistItems(
	deps: MutationDeps,
	checklistId: string,
	texts: string[]
): Promise<ChecklistItem[]> {
	const checklist = deps.getChecklistById(checklistId);
	let nextSortOrder = checklist?.items.length ?? 0;
	const created: ChecklistItem[] = [];
	for (const rawText of texts) {
		const text = rawText.trim();
		if (!text) continue;
		const response = await fetch(`/api/checklists/${checklistId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, count: 1, sortOrder: nextSortOrder })
		});
		if (!response.ok) continue;
		const added = await response.json() as ChecklistItem[];
		created.push(...added);
		nextSortOrder += Math.max(added.length, 1);
	}
	if (created.length > 0 && checklist) {
		deps.updateChecklistById(checklistId, (current) => ({
			...current,
			items: [...current.items, ...created]
		}));
	}
	return created;
}

// ── Set checklist completed ──

export async function setChecklistCompleted(
	deps: MutationDeps,
	checklistId: string,
	completed: boolean
): Promise<boolean> {
	const completedAt = completed ? new Date().toISOString() : null;
	const response = await fetch(`/api/checklists/${checklistId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ completedAt })
	});
	if (!response.ok) return false;
	deps.updateChecklistById(checklistId, (current) => ({ ...current, completedAt }));
	return true;
}

// ── Breakdown ──

export async function handleBreakdownSave(
	deps: MutationDeps,
	breakdownTarget: { checklistId: string; item: ChecklistItem },
	subtasks: string[]
): Promise<void> {
	const { checklistId, item } = breakdownTarget;
	try {
		const res = await fetch('/api/breakdown/save', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ parentItemId: item.id, subtasks, breakdownPrompt: item.text })
		});
		if (!res.ok) throw new Error('Failed to save breakdown');
		const result = await res.json() as { subtasks: ChecklistItem[] };
		deps.updateChecklistById(checklistId, (current) => ({
			...current,
			items: [
				...current.items.map((i) => i.id === item.id
					? { ...i, metadata: { ...(i.metadata as Record<string, unknown> ?? {}), hasBreakdown: true } }
					: i),
				...(result.subtasks ?? [])
			]
		}));
	} catch (err) { console.error('Error saving breakdown:', err); }
}

// ── Confirm auto check ──

export async function confirmAutoCheck(
	prompt: AutoCheckPrompt,
	updateChecklistById: UpdateChecklistById
): Promise<void> {
	await applyAutoCheck(prompt, updateChecklistById);
}
