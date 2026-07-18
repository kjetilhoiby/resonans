/**
 * Ren forretningslogikk for WeekTasks — løftet ut av komponenten
 * for testbarhet (se week-tasks-logic.test.ts).
 */
import { dimensionById, type LivskompassGoal } from '$lib/domains/livskompass/dimensions';
import type { WeekChecklist, WeekTask } from './types';

// ── Livskompass-mål i ukeplanen ─────────────────────────────────────────────

export interface KompassGoalView extends LivskompassGoal {
	label: string;
	color: string;
	itemsTotal: number;
	itemsChecked: number;
}

/**
 * Beriker ukas kompass-mål med label/farge og live tiltaksstatus fra ukelista
 * (punkter med metadata.source = 'livskompass'). Telles fra klient-staten så
 * stripa oppdateres i det brukeren huker av.
 */
export function livskompassGoalViews(
	checklist: WeekChecklist | null,
	goals: LivskompassGoal[] | null | undefined
): KompassGoalView[] {
	if (!goals?.length) return [];
	const counts: Record<string, { total: number; checked: number }> = {};
	for (const item of checklist?.items ?? []) {
		if (item.metadata?.source !== 'livskompass') continue;
		const dim = item.metadata?.livskompassDimension;
		if (!dim) continue;
		const entry = (counts[dim] ??= { total: 0, checked: 0 });
		entry.total += 1;
		if (item.checked) entry.checked += 1;
	}
	return goals.map((g) => {
		const def = dimensionById(g.dimensionId);
		return {
			...g,
			label: def?.label ?? g.dimensionId,
			color: def?.color ?? '#7c8ef5',
			itemsTotal: counts[g.dimensionId]?.total ?? 0,
			itemsChecked: counts[g.dimensionId]?.checked ?? 0
		};
	});
}

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
		const unit = task.unit || 'ganger';
		const unitLabel = task.targetValue === 1 && unit === 'ganger' ? 'gang' : unit;
		if (task.frequency === 'daily') return `${task.targetValue} ${unitLabel} per dag`;
		if (task.frequency === 'weekly') return `${task.targetValue} ${unitLabel} denne uka`;
		if (task.frequency === 'monthly') return `${task.targetValue} ${unitLabel} denne måneden`;
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
	// Standard-tolkning (frekvens fra oppgaven, ikke teksten) er ikke «aktiv
	// sporing» — en vanlig ukeoppgave skal ikke bære badge.
	if (status === 'parsed') {
		if (task.metadata?.intentParser === 'default') return null;
		return { label: 'Aktiv sporing', tone: 'parsed' };
	}
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
