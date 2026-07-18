import { describe, it, expect } from 'vitest';
import { buildMetricGoalEval } from './metric-goal-eval';

describe('buildMetricGoalEval', () => {
	it('lavere-er-bedre (hvilepuls): at_most-sone, innenfor når current ≤ target', () => {
		const e = buildMetricGoalEval({
			metricId: 'resting_heart_rate',
			direction: 'lower_is_better',
			current: 53.2,
			target: 55,
			unit: 'slag/min'
		});
		expect(e.mode).toBe('at_most');
		expect(e.withinTarget).toBe(true);
		expect(e.domainMin).toBeLessThan(53.2);
		expect(e.domainMax).toBeGreaterThan(55);

		expect(
			buildMetricGoalEval({ metricId: 'resting_heart_rate', direction: 'lower_is_better', current: 58, target: 55, unit: 'slag/min' }).withinTarget
		).toBe(false);
	});

	it('høyere-er-bedre (belastning): at_least-sone med kontekstlinje', () => {
		const e = buildMetricGoalEval({
			metricId: 'weekly_effort',
			direction: 'higher_is_better',
			current: 340,
			target: 300,
			unit: 'poeng',
			contextLabel: '4-ukers snitt: 310'
		});
		expect(e.mode).toBe('at_least');
		expect(e.withinTarget).toBe(true);
		expect(e.contextLabel).toBe('4-ukers snitt: 310');
	});

	it('uten data → ingen dom, men sonen bygges rundt målet', () => {
		const e = buildMetricGoalEval({
			metricId: 'running_5k_time',
			direction: 'lower_is_better',
			current: null,
			target: 1500,
			unit: 'sek'
		});
		expect(e.withinTarget).toBeNull();
		expect(e.domainMin).toBeLessThan(1500);
		expect(e.domainMax).toBeGreaterThan(1500);
	});

	it('nåverdi langt utenfor sonen utvider domenet så markøren er synlig', () => {
		const e = buildMetricGoalEval({
			metricId: 'running_5k_time',
			direction: 'lower_is_better',
			current: 2400,
			target: 1500,
			unit: 'sek'
		});
		expect(e.domainMax).toBeGreaterThanOrEqual(2400);
	});

	it('domenet klippes ved 0 for positive mål', () => {
		const e = buildMetricGoalEval({
			metricId: 'fat_mass',
			direction: 'lower_is_better',
			current: 2,
			target: 3,
			unit: 'kg'
		});
		expect(e.domainMin).toBeGreaterThanOrEqual(0);
	});
});
