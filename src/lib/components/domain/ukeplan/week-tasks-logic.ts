/**
 * Ren forretningslogikk for WeekTasks — løftet ut av komponenten
 * for testbarhet (se week-tasks-logic.test.ts).
 */
import type { WeekChecklist, WeekTask } from './types';

export function checklistProgress(checklist: WeekChecklist | null): { done: number; total: number; pct: number } {
	const counted = (checklist?.items ?? []).filter((item) => {
		const kind = item.metadata?.kind;
		return kind !== 'location' && kind !== 'travel';
	});
	if (counted.length === 0) return { done: 0, total: 0, pct: 0 };
	const done = counted.filter((item) => item.checked).length;
	const total = counted.length;
	return { done, total, pct: Math.round((done / total) * 100) };
}

export function slotState(task: WeekTask, index: number): boolean {
	return task.completedCount > index;
}

export function doneTask(task: WeekTask): boolean {
	return task.completedCount >= task.repeatCount;
}

export function formatStructuredTaskMeta(task: WeekTask): string | null {
	if (!task.frequency) return null;
	if (typeof task.targetValue === 'number' && task.targetValue > 0) {
		if (task.frequency === 'daily') return `${task.targetValue} ${task.unit || 'ganger'} per dag`;
		if (task.frequency === 'weekly') return `${task.targetValue} ${task.unit || 'ganger'} denne uka`;
		if (task.frequency === 'monthly') return `${task.targetValue} ${task.unit || 'ganger'} denne måneden`;
	}
	const labels: Record<string, string> = { daily: 'daglig', weekly: 'ukentlig', monthly: 'månedlig', once: 'én gang' };
	return labels[task.frequency] ?? task.frequency;
}

export interface TaskIntentBadge {
	label: string;
	tone: 'pending' | 'parsed' | 'failed';
}

export function getTaskIntentBadge(task: WeekTask): TaskIntentBadge | null {
	const status = task.metadata?.intentStatus;
	if (status === 'pending') return { label: 'Tolkes...', tone: 'pending' };
	if (status === 'parsed') return { label: 'Aktiv sporing', tone: 'parsed' };
	if (status === 'failed') return { label: 'Trenger avklaring', tone: 'failed' };
	return null;
}

export function getTaskIntentFailureReasonLabel(task: WeekTask): string | null {
	if (task.metadata?.intentStatus !== 'failed') return null;
	const reason = task.metadata?.intentError;
	if (!reason) return null;
	const reasonMap: Record<string, string> = {
		empty_text: 'Ingen tekst å tolke.',
		unsupported_activity: 'Støtter foreløpig bare løpemål i denne flyten.',
		unsupported_period_or_threshold: 'Fant ikke tydelig frekvens som "X ganger per uke".',
		no_quantifiable_target: 'Fant ikke frekvens – legg til f.eks. "5 ganger per uke".',
		invalid_threshold: 'Kunne ikke lese målverdi for antall per uke.',
		unknown: 'Ukjent parse-feil.'
	};
	return reasonMap[reason] ?? `Tolking feilet (${reason}).`;
}

export function getTaskEvaluationLabel(task: WeekTask): string | null {
	const e = task.metadata?.intentEvaluation;
	if (!e) return null;
	if (typeof e.currentValue !== 'number' || typeof e.targetValue !== 'number') return null;
	if (e.targetValue <= 0) return null;
	const pct = Math.max(0, Math.min(100, Math.round((e.currentValue / e.targetValue) * 100)));
	const metText = e.met ? 'oppnådd' : 'pågår';
	return `${e.currentValue}/${e.targetValue} denne uka (${pct}%) · ${metText}`;
}
