import { describe, it, expect } from 'vitest';
import { scheduleLabel, buildScheduleLink, isAlreadyScheduled } from './week-schedule-logic';
import type { ChecklistItem, WeekTask } from './types';

function mkTask(overrides: Partial<WeekTask> = {}): WeekTask {
	return {
		id: 't1',
		title: 'Løp',
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

function mkItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
	return {
		id: 'i1',
		text: 'Løp (1/3)',
		checked: false,
		metadata: null,
		...overrides
	};
}

describe('scheduleLabel', () => {
	it('fjerner gjentaks-suffiks (n/m)', () => {
		expect(scheduleLabel('Løp (1/3)')).toBe('Løp');
		expect(scheduleLabel('Yoga (12/12)')).toBe('Yoga');
	});

	it('fjerner etterstilt antall-frase', () => {
		expect(scheduleLabel('Løp tre ganger')).toBe('Løp');
		expect(scheduleLabel('Handle 5 dager')).toBe('Handle');
		expect(scheduleLabel('Møte 2 uker')).toBe('Møte');
	});

	it('lar vanlig tittel stå urørt', () => {
		expect(scheduleLabel('Drikk vann')).toBe('Drikk vann');
		expect(scheduleLabel('Ring rørlegger')).toBe('Ring rørlegger');
	});

	it('håndterer tom/blank input', () => {
		expect(scheduleLabel('')).toBe('');
		expect(scheduleLabel(null)).toBe('');
		expect(scheduleLabel('   ')).toBe('');
	});
});

describe('buildScheduleLink', () => {
	it('bygger task-link med renset tittel', () => {
		const { label, link } = buildScheduleLink({ kind: 'task', task: mkTask({ title: 'Løp tre ganger' }) });
		expect(label).toBe('Løp');
		expect(link.taskId).toBe('t1');
		expect(link.taskTitle).toBe('Løp');
		expect(link.checklistItemId).toBeUndefined();
	});

	it('viderefører aktivitets-metadata fra oppgaven', () => {
		const task = mkTask({ metadata: { activityType: 'running', durationMinutes: 30, distanceKm: 5 } });
		const { link } = buildScheduleLink({ kind: 'task', task });
		expect(link.activityType).toBe('running');
		expect(link.durationMinutes).toBe(30);
		expect(link.distanceKm).toBe(5);
	});

	it('leser aktivitets-metadata fra parsedIntent når direkte felt mangler', () => {
		const task = mkTask({ metadata: { parsedIntent: { activityType: 'cycling' } } });
		const { link } = buildScheduleLink({ kind: 'task', task });
		expect(link.activityType).toBe('cycling');
	});

	it('bygger item-link mot ukeliste-punktet', () => {
		const { label, link } = buildScheduleLink({
			kind: 'item',
			item: mkItem({ id: 'x9', text: 'Løp (2/3)', metadata: { activityType: 'running' } })
		});
		expect(label).toBe('Løp');
		expect(link.checklistItemId).toBe('x9');
		expect(link.taskId).toBeUndefined();
		expect(link.activityType).toBe('running');
	});
});

describe('isAlreadyScheduled', () => {
	it('finner ikke-avkrysset punkt koblet til samme oppgave', () => {
		const dayItems = [mkItem({ id: 'd1', checked: false, metadata: { linkedTaskId: 't1' } })];
		expect(isAlreadyScheduled(dayItems, { taskId: 't1' })).toBe(true);
		expect(isAlreadyScheduled(dayItems, { taskId: 't2' })).toBe(false);
	});

	it('finner ikke-avkrysset punkt koblet til samme ukeliste-punkt', () => {
		const dayItems = [mkItem({ id: 'd1', checked: false, metadata: { linkedChecklistItemId: 'w1' } })];
		expect(isAlreadyScheduled(dayItems, { checklistItemId: 'w1' })).toBe(true);
		expect(isAlreadyScheduled(dayItems, { checklistItemId: 'w2' })).toBe(false);
	});

	it('ignorerer allerede avkryssede punkter (kan planlegges på nytt)', () => {
		const dayItems = [mkItem({ id: 'd1', checked: true, metadata: { linkedTaskId: 't1' } })];
		expect(isAlreadyScheduled(dayItems, { taskId: 't1' })).toBe(false);
	});

	it('er false for tom dag-liste', () => {
		expect(isAlreadyScheduled([], { taskId: 't1' })).toBe(false);
	});
});
