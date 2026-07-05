import { describe, it, expect } from 'vitest';
import {
	buildDefaultIntentFromTask,
	detectActivityType,
	parseTaskIntent,
	LONG_RUN_DISTANCE_KM
} from './task-intent-parser';

describe('detectActivityType – aliaser', () => {
	it('rulle/elsykkel → ebike', () => {
		expect(detectActivityType('rulle')).toBe('ebike');
		expect(detectActivityType('rulle fire ganger')).toBe('ebike');
		expect(detectActivityType('elsykle til jobb')).toBe('ebike');
		expect(detectActivityType('elsykkel')).toBe('ebike');
	});

	it('tråkke/sykle → cycling', () => {
		expect(detectActivityType('tråkke')).toBe('cycling');
		expect(detectActivityType('tråkke fire ganger')).toBe('cycling');
		expect(detectActivityType('sykle til jobb')).toBe('cycling');
	});

	it('elsykkel og sykkel er adskilt', () => {
		expect(detectActivityType('elsykkel')).not.toBe('cycling');
		expect(detectActivityType('rulle')).not.toBe('cycling');
		expect(detectActivityType('tråkke')).not.toBe('ebike');
	});

	it('andre aktiviteter', () => {
		expect(detectActivityType('yoga')).toBe('yoga');
		expect(detectActivityType('styrke')).toBe('strength');
		expect(detectActivityType('løpe')).toBe('running');
		expect(detectActivityType('jogge')).toBe('running');
	});

	it('ukjent → undefined', () => {
		expect(detectActivityType('ring mamma')).toBeUndefined();
	});
});

describe('parseTaskIntent – «langt» løp', () => {
	it('«jogge langt» får distanceKm = LONG_RUN_DISTANCE_KM', () => {
		const r = parseTaskIntent('jogge langt');
		expect(r.matched).toBe(true);
		expect(r.intent?.activityType).toBe('running');
		expect(r.intent?.distanceKm).toBe(LONG_RUN_DISTANCE_KM);
	});

	it('eksplisitt distanse vinner over «langt»', () => {
		const r = parseTaskIntent('løpe 8 km');
		expect(r.intent?.distanceKm).toBe(8);
	});

	it('«langt» gir ikke distanse for ikke-løp', () => {
		// "sykle langt" → cycling uten kvantifiserbart mål → ingen intent
		const r = parseTaskIntent('sykle langt');
		expect(r.intent?.distanceKm).toBeUndefined();
	});
});

describe('buildDefaultIntentFromTask – frekvens fra oppgaven når teksten mangler den', () => {
	it('ukeplan-oppgave uten frekvens i teksten → 1 gang denne uka', () => {
		// «Vaske bil» opprettet fra ukeplanen med frequency='weekly'
		expect(parseTaskIntent('Vaske bil').matched).toBe(false);

		const r = buildDefaultIntentFromTask(
			{ frequency: 'weekly', targetValue: null, unit: null },
			'Vaske bil'
		);
		expect(r?.matched).toBe(true);
		expect(r?.parser).toBe('default');
		expect(r?.intent).toEqual({
			frequency: 'weekly',
			targetValue: 1,
			unit: 'ganger',
			period: 'week',
			comparator: '>=',
			sourceText: 'Vaske bil'
		});
	});

	it('beholder eksisterende målverdi og enhet', () => {
		const r = buildDefaultIntentFromTask(
			{ frequency: 'daily', targetValue: 3, unit: 'glass' },
			'Drikke vann'
		);
		expect(r?.intent?.targetValue).toBe(3);
		expect(r?.intent?.unit).toBe('glass');
		expect(r?.intent?.period).toBe('day');
	});

	it('mapper alle frekvenser til riktig periode', () => {
		expect(buildDefaultIntentFromTask({ frequency: 'monthly', targetValue: null, unit: null }, 'x')?.intent?.period).toBe('month');
		expect(buildDefaultIntentFromTask({ frequency: 'once', targetValue: null, unit: null }, 'x')?.intent?.period).toBe('day');
	});

	it('gir null uten frekvens eller med ukjent frekvens — da trengs avklaring', () => {
		expect(buildDefaultIntentFromTask({ frequency: null, targetValue: null, unit: null }, 'Vaske bil')).toBeNull();
		expect(buildDefaultIntentFromTask({ frequency: 'annenhver', targetValue: null, unit: null }, 'Vaske bil')).toBeNull();
	});

	it('normaliserer ugyldig målverdi og tom enhet', () => {
		const r = buildDefaultIntentFromTask({ frequency: 'weekly', targetValue: 0, unit: '  ' }, 'Rydde garasjen');
		expect(r?.intent?.targetValue).toBe(1);
		expect(r?.intent?.unit).toBe('ganger');
	});
});
