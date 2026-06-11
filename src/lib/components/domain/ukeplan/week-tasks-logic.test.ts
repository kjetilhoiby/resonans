import { describe, it, expect } from 'vitest';
import {
	checklistProgress,
	slotState,
	doneTask,
	formatStructuredTaskMeta,
	getTaskIntentBadge,
	getTaskIntentFailureReasonLabel,
	getTaskEvaluationLabel
} from './week-tasks-logic';
import type { WeekChecklist, WeekTask } from './types';

function mkTask(overrides: Partial<WeekTask> = {}): WeekTask {
	return {
		id: 't1',
		title: 'Svømme',
		frequency: null,
		targetValue: null,
		unit: null,
		metadata: {},
		repeatCount: 1,
		completedCount: 0,
		goalTitle: null,
		themeName: null,
		...overrides
	};
}

function mkChecklist(items: Array<{ checked: boolean; kind?: string }>): WeekChecklist {
	return {
		id: 'c1',
		title: 'Uka',
		emoji: '📋',
		completedAt: null,
		items: items.map((it, i) => ({
			id: `i${i}`,
			text: `Punkt ${i}`,
			checked: it.checked,
			metadata: it.kind ? { kind: it.kind } : null
		}))
	};
}

describe('checklistProgress', () => {
	it('teller avkryssede mot totalen', () => {
		const checklist = mkChecklist([{ checked: true }, { checked: true }, { checked: false }, { checked: false }]);
		expect(checklistProgress(checklist)).toEqual({ done: 2, total: 4, pct: 50 });
	});

	it('utelater sted- og reise-punkter', () => {
		const checklist = mkChecklist([
			{ checked: true },
			{ checked: false, kind: 'location' },
			{ checked: false, kind: 'travel' }
		]);
		expect(checklistProgress(checklist)).toEqual({ done: 1, total: 1, pct: 100 });
	});

	it('gir 0/0 for null og tom liste', () => {
		expect(checklistProgress(null)).toEqual({ done: 0, total: 0, pct: 0 });
		expect(checklistProgress(mkChecklist([]))).toEqual({ done: 0, total: 0, pct: 0 });
	});

	it('runder prosent', () => {
		const checklist = mkChecklist([{ checked: true }, { checked: false }, { checked: false }]);
		expect(checklistProgress(checklist).pct).toBe(33);
	});
});

describe('slotState og doneTask', () => {
	it('fyller slots opp til completedCount', () => {
		const task = mkTask({ repeatCount: 3, completedCount: 2 });
		expect(slotState(task, 0)).toBe(true);
		expect(slotState(task, 1)).toBe(true);
		expect(slotState(task, 2)).toBe(false);
		expect(doneTask(task)).toBe(false);
	});

	it('er ferdig når completedCount når repeatCount', () => {
		expect(doneTask(mkTask({ repeatCount: 2, completedCount: 2 }))).toBe(true);
		expect(doneTask(mkTask({ repeatCount: 2, completedCount: 3 }))).toBe(true);
	});
});

describe('formatStructuredTaskMeta', () => {
	it('gir null uten frekvens', () => {
		expect(formatStructuredTaskMeta(mkTask())).toBeNull();
	});

	it('formaterer målverdi per frekvens', () => {
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'daily', targetValue: 2, unit: 'glass' }))).toBe('2 glass per dag');
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'weekly', targetValue: 3 }))).toBe('3 ganger denne uka');
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'monthly', targetValue: 1 }))).toBe('1 ganger denne måneden');
	});

	it('faller tilbake til frekvens-label uten målverdi', () => {
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'daily' }))).toBe('daglig');
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'once' }))).toBe('én gang');
		expect(formatStructuredTaskMeta(mkTask({ frequency: 'annenhver' }))).toBe('annenhver');
	});
});

describe('getTaskIntentBadge', () => {
	it('mapper intentStatus til badge', () => {
		expect(getTaskIntentBadge(mkTask({ metadata: { intentStatus: 'pending' } }))).toEqual({ label: 'Tolkes...', tone: 'pending' });
		expect(getTaskIntentBadge(mkTask({ metadata: { intentStatus: 'parsed' } }))).toEqual({ label: 'Aktiv sporing', tone: 'parsed' });
		expect(getTaskIntentBadge(mkTask({ metadata: { intentStatus: 'failed' } }))).toEqual({ label: 'Trenger avklaring', tone: 'failed' });
	});

	it('gir null uten intentStatus', () => {
		expect(getTaskIntentBadge(mkTask())).toBeNull();
	});
});

describe('getTaskIntentFailureReasonLabel', () => {
	it('gir null når status ikke er failed', () => {
		expect(getTaskIntentFailureReasonLabel(mkTask({ metadata: { intentStatus: 'parsed', intentError: 'unknown' } }))).toBeNull();
	});

	it('mapper kjente feilkoder', () => {
		expect(
			getTaskIntentFailureReasonLabel(mkTask({ metadata: { intentStatus: 'failed', intentError: 'no_quantifiable_target' } }))
		).toBe('Fant ikke frekvens – legg til f.eks. "5 ganger per uke".');
	});

	it('gir generisk tekst for ukjente koder', () => {
		expect(
			getTaskIntentFailureReasonLabel(mkTask({ metadata: { intentStatus: 'failed', intentError: 'whatever' } }))
		).toBe('Tolking feilet (whatever).');
	});

	it('gir null uten feilkode', () => {
		expect(getTaskIntentFailureReasonLabel(mkTask({ metadata: { intentStatus: 'failed' } }))).toBeNull();
	});
});

describe('getTaskEvaluationLabel', () => {
	it('formaterer fremdrift med prosent og status', () => {
		const task = mkTask({ metadata: { intentEvaluation: { currentValue: 1, targetValue: 2, met: false } } });
		expect(getTaskEvaluationLabel(task)).toBe('1/2 denne uka (50%) · pågår');
	});

	it('markerer oppnådd og klamper til 100 %', () => {
		const task = mkTask({ metadata: { intentEvaluation: { currentValue: 5, targetValue: 3, met: true } } });
		expect(getTaskEvaluationLabel(task)).toBe('5/3 denne uka (100%) · oppnådd');
	});

	it('gir null uten evaluering eller ved ugyldige verdier', () => {
		expect(getTaskEvaluationLabel(mkTask())).toBeNull();
		expect(getTaskEvaluationLabel(mkTask({ metadata: { intentEvaluation: { currentValue: 'x', targetValue: 2 } } }))).toBeNull();
		expect(getTaskEvaluationLabel(mkTask({ metadata: { intentEvaluation: { currentValue: 1, targetValue: 0 } } }))).toBeNull();
	});
});
