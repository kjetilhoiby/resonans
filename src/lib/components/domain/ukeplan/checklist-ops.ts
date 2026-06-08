import type { ChecklistItem, DayChecklist, WeekChecklist, SaveState } from './types';

export type ChecklistUpdater = (checklist: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist;

export interface ChecklistState {
	weekChecklistState: WeekChecklist | null;
	dayChecklistsState: Record<string, DayChecklist>;
}

export function getChecklistById(state: ChecklistState, checklistId: string) {
	if (state.weekChecklistState?.id === checklistId) return state.weekChecklistState;
	for (const checklist of Object.values(state.dayChecklistsState)) {
		if (checklist.id === checklistId) return checklist;
	}
	return null;
}

export function saveKeyForChecklist(weekChecklistId: string | null, checklistId: string): string {
	return weekChecklistId === checklistId ? 'weekItems' : 'dayItems';
}

export async function apiCreateItems(
	checklistId: string,
	text: string,
	count: number,
	sortOrder: number
): Promise<ChecklistItem[] | null> {
	const response = await fetch(`/api/checklists/${checklistId}/items`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, count, sortOrder })
	});
	if (!response.ok) return null;
	return await response.json() as ChecklistItem[];
}

export async function apiPatchItem(
	checklistId: string,
	itemId: string,
	patch: Record<string, unknown>
): Promise<boolean> {
	const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch)
	});
	return response.ok;
}

export async function apiDeleteItem(checklistId: string, itemId: string): Promise<boolean> {
	const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, { method: 'DELETE' });
	return response.ok;
}

/** Find all sibling repeat items (e.g., "Yoga (1/4)" … "(4/4)") */
export function findRepeatGroup(items: ChecklistItem[], itemId: string): string[] {
	const repeatRe = /^(.+?)\s+\(\d+\/\d+\)$/;
	const target = items.find((i) => i.id === itemId);
	const repeatMatch = target?.text.match(repeatRe);
	if (!target || !repeatMatch) return [itemId];
	const base = repeatMatch[1].trim().toLowerCase();
	return items
		.filter((i) => (i.parentId ?? null) === (target.parentId ?? null))
		.filter((i) => {
			const m = i.text.match(repeatRe);
			return m !== null && m[1].trim().toLowerCase() === base;
		})
		.map((i) => i.id);
}
