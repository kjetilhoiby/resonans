import type { ChecklistItem, WeekChecklist, DayChecklist } from './types';

export type AutoCheckPrompt =
	| { kind: 'day'; checklistId: string; itemId: string; itemText: string; activityType: string; durationMinutes: number | null; startTimeIso: string | null }
	| { kind: 'week'; checklistId: string; baseLabel: string; activityType: string; workoutCount: number; totalSlots: number; suggested: number };

/**
 * After creating items, check if any match existing workout sessions.
 * Returns an AutoCheckPrompt if one is found, or null.
 */
export async function detectAutoCheck(
	checklistId: string,
	created: ChecklistItem[],
	weekChecklistId: string | null
): Promise<AutoCheckPrompt | null> {
	// Week checklist: check for weekly activity group
	if (weekChecklistId === checklistId) {
		const first = created.find((i) => !i.checked && i.metadata?.activityType);
		if (!first) return null;
		const baseLabel = first.text.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
		try {
			const res = await fetch(`/api/checklists/${checklistId}/autocheck-week?baseLabel=${encodeURIComponent(baseLabel)}`);
			if (!res.ok) return null;
			const body = await res.json() as {
				group: { activityType: string; workoutCount: number; totalSlots: number; newlyChecked: number } | null;
			};
			if (body.group && body.group.newlyChecked > 0) {
				return {
					kind: 'week', checklistId, baseLabel,
					activityType: body.group.activityType, workoutCount: body.group.workoutCount,
					totalSlots: body.group.totalSlots, suggested: body.group.newlyChecked
				};
			}
		} catch { /* best-effort */ }
		return null;
	}

	// Day checklist: check individual items
	for (const item of created) {
		if (item.checked || !item.metadata?.activityType) continue;
		try {
			const res = await fetch(`/api/checklists/${checklistId}/items/${item.id}/autocheck`);
			if (!res.ok) continue;
			const body = await res.json() as {
				match: { durationMinutes: number | null; startTimeIso: string | null } | null;
				itemText?: string;
				activityType?: string;
			};
			if (body.match) {
				return {
					kind: 'day', checklistId, itemId: item.id,
					itemText: body.itemText ?? item.text,
					activityType: body.activityType ?? item.metadata.activityType,
					durationMinutes: body.match.durationMinutes,
					startTimeIso: body.match.startTimeIso
				};
			}
		} catch { /* best-effort */ }
	}
	return null;
}

type ChecklistUpdater = (checklistId: string, updater: (c: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist) => void;

export async function applyAutoCheck(
	prompt: AutoCheckPrompt,
	updateChecklistById: ChecklistUpdater
): Promise<boolean> {
	if (prompt.kind === 'day') {
		const res = await fetch(`/api/checklists/${prompt.checklistId}/items/${prompt.itemId}/autocheck`, { method: 'POST' });
		if (res.ok) {
			updateChecklistById(prompt.checklistId, (current) => ({
				...current,
				items: current.items.map((i) => i.id === prompt.itemId
					? { ...i, checked: true, metadata: { ...(i.metadata ?? {}), autoChecked: true } }
					: i)
			}));
			return true;
		}
	} else {
		const res = await fetch(`/api/checklists/${prompt.checklistId}/autocheck-week`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ baseLabel: prompt.baseLabel })
		});
		if (res.ok) {
			const body = await res.json() as { group: { itemIds: string[] } | null };
			const ids = new Set(body.group?.itemIds ?? []);
			if (ids.size > 0) {
				updateChecklistById(prompt.checklistId, (current) => ({
					...current,
					items: current.items.map((i) => ids.has(i.id)
						? { ...i, checked: true, metadata: { ...(i.metadata ?? {}), autoChecked: true } }
						: i)
				}));
				return true;
			}
		}
	}
	return false;
}
