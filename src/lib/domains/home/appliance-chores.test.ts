import { describe, it, expect } from 'vitest';
import {
	choresForAppliance,
	normalizeApplianceName,
	computeChoreStats,
	parseChorePrefix,
	type ChoreCountItem
} from './appliance-chores';

describe('normalizeApplianceName', () => {
	it('stripper norsk bestemt form og store bokstaver', () => {
		expect(normalizeApplianceName('Vaskemaskinen')).toBe('vaskemaskin');
		expect(normalizeApplianceName('Tørketrommelen')).toBe('tørketrommel');
		expect(normalizeApplianceName('Oppvaskmaskin')).toBe('oppvaskmaskin');
	});
});

describe('choresForAppliance', () => {
	it('finner gjøremål for vaskemaskin uansett bøyning', () => {
		expect(choresForAppliance('Vaskemaskinen')).toEqual(['Tøm vaskemaskin', 'Heng opp klær']);
		expect(choresForAppliance('vaskemaskin')).toEqual(['Tøm vaskemaskin', 'Heng opp klær']);
	});

	it('finner gjøremål for tørketrommel og oppvaskmaskin', () => {
		expect(choresForAppliance('Tørketrommelen')).toEqual([
			'Tøm tørketrommel',
			'Brett og legg vekk klær'
		]);
		expect(choresForAppliance('Oppvaskmaskinen')).toEqual(['Tøm oppvaskmaskin']);
	});

	it('returnerer tom liste for ukjent apparat', () => {
		expect(choresForAppliance('Kjøleskap')).toEqual([]);
		expect(choresForAppliance('')).toEqual([]);
	});
});

describe('parseChorePrefix', () => {
	it('plukker opp chore-prefiks og stripper det (case-insensitivt)', () => {
		expect(parseChorePrefix('chore: Tøm oppvask')).toEqual({ chore: true, text: 'Tøm oppvask' });
		expect(parseChorePrefix('Chore:Rydde kjøkken')).toEqual({ chore: true, text: 'Rydde kjøkken' });
		expect(parseChorePrefix('  chore:  Vanne planter ')).toEqual({
			chore: true,
			text: 'Vanne planter'
		});
	});

	it('lar vanlig tekst stå urørt', () => {
		expect(parseChorePrefix('Tøm oppvask')).toEqual({ chore: false, text: 'Tøm oppvask' });
		expect(parseChorePrefix('kjøp: melk')).toEqual({ chore: false, text: 'kjøp: melk' });
	});
});

describe('computeChoreStats', () => {
	const now = new Date('2026-06-20T12:00:00Z');

	function item(daysAgo: number, checked: boolean): ChoreCountItem {
		return { checked, createdAt: new Date(now.getTime() - daysAgo * 86_400_000) };
	}

	it('teller brutto og fullført innenfor 7-dagers vindu', () => {
		const items = [item(0, true), item(1, false), item(3, true), item(6, false)];
		expect(computeChoreStats(items, 7, now)).toEqual({ gross: 4, completed: 2, windowDays: 7 });
	});

	it('ekskluderer husarbeid eldre enn vinduet', () => {
		const items = [item(2, true), item(8, true), item(30, false)];
		expect(computeChoreStats(items, 7, now)).toEqual({ gross: 1, completed: 1, windowDays: 7 });
	});

	it('takler ugyldige datoer og tom liste', () => {
		expect(computeChoreStats([], 7, now)).toEqual({ gross: 0, completed: 0, windowDays: 7 });
		expect(
			computeChoreStats([{ checked: true, createdAt: 'ugyldig' }], 7, now)
		).toEqual({ gross: 0, completed: 0, windowDays: 7 });
	});
});
