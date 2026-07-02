import { describe, it, expect } from 'vitest';
import { planMonthTask, MAX_MONTH_TASK_SLOTS } from './month-plan-tasks';

describe('planMonthTask', () => {
	it('lager ett enkelt punkt når antallet er 1', () => {
		const plan = planMonthTask({ title: 'Rydde snekkerbod', value: 1, unit: 'ganger' });
		expect(plan).toEqual({
			parentLabel: 'Rydde snekkerbod',
			slotCount: 1,
			childLabel: 'Rydde snekkerbod'
		});
	});

	it('behandler antall under 1 som ett enkelt punkt', () => {
		const plan = planMonthTask({ title: 'Yoga', value: 0, unit: 'ganger' });
		expect(plan.slotCount).toBe(1);
		expect(plan.parentLabel).toBe('Yoga');
	});

	it('lager foreldre-label med antall og enhet for flere slots', () => {
		const plan = planMonthTask({ title: 'Svømme ute', value: 4, unit: 'ganger' });
		expect(plan).toEqual({
			parentLabel: 'Svømme ute (4 ganger)',
			slotCount: 4,
			childLabel: 'Svømme ute'
		});
	});

	it('klamper en for høy frekvens til maks antall slots', () => {
		const plan = planMonthTask({ title: 'Yoga', value: 20, unit: 'ganger' });
		expect(plan.slotCount).toBe(MAX_MONTH_TASK_SLOTS);
		expect(plan.parentLabel).toBe(`Yoga (${MAX_MONTH_TASK_SLOTS} ganger)`);
		expect(plan.childLabel).toBe('Yoga');
	});

	it('runder ned desimaltall', () => {
		const plan = planMonthTask({ title: 'Sykle til jobb', value: 3.9, unit: 'ganger' });
		expect(plan.slotCount).toBe(3);
	});

	it('trimmer tittel og tåler manglende enhet', () => {
		const plan = planMonthTask({ title: '  Lese  ', value: 2, unit: '' });
		expect(plan).toEqual({ parentLabel: 'Lese (2)', slotCount: 2, childLabel: 'Lese' });
	});
});
