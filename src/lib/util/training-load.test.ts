import { describe, it, expect } from 'vitest';
import { classifyTsb, computeTrainingLoad } from './training-load';

describe('classifyTsb', () => {
	it('gir «Ingen data» uten et tall, uten å påstå balanse', () => {
		const status = classifyTsb(null);
		expect(status.label).toBe('Ingen data');
		expect(status.tone).toBe('neutral');
		expect(status.hint).toBe('');
	});

	/**
	 * Grensene deles med `LoadBalanceCard` og med chatten (query_training). Testen
	 * står på grenseverdiene, siden det er der to implementasjoner ville sprunget
	 * fra hverandre — og en assistent som kaller −14 «i balanse» mens skjermen sier
	 * «Sliten» er verre enn en som ikke svarer.
	 */
	it('treffer båndene på grenseverdiene', () => {
		expect(classifyTsb(15).label).toBe('Veldig fersk');
		expect(classifyTsb(14.9).label).toBe('Fersk');
		expect(classifyTsb(5).label).toBe('Fersk');
		expect(classifyTsb(4.9).label).toBe('I balanse');
		expect(classifyTsb(0).label).toBe('I balanse');
		expect(classifyTsb(-10).label).toBe('I balanse');
		expect(classifyTsb(-10.1).label).toBe('Sliten');
		expect(classifyTsb(-14).label).toBe('Sliten');
		expect(classifyTsb(-25).label).toBe('Sliten');
		expect(classifyTsb(-25.1).label).toBe('Veldig sliten');
	});

	it('holder tone og merkelapp i takt', () => {
		expect(classifyTsb(20).tone).toBe('fresh');
		expect(classifyTsb(0).tone).toBe('balanced');
		expect(classifyTsb(-30).tone).toBe('tired');
	});
});

describe('computeTrainingLoad', () => {
	it('fyller hull med 0 — en hviledag er et datapunkt, ikke et hull', () => {
		const points = computeTrainingLoad([
			{ date: '2026-08-01', effort: 100 },
			{ date: '2026-08-04', effort: 100 }
		]);
		expect(points.map((p) => p.date)).toEqual([
			'2026-08-01',
			'2026-08-02',
			'2026-08-03',
			'2026-08-04'
		]);
		expect(points[1].effort).toBe(0);
	});

	it('lar ATL svare raskere enn CTL på en hard dag', () => {
		const points = computeTrainingLoad([{ date: '2026-08-01', effort: 100 }]);
		expect(points[0].atl).toBeGreaterThan(points[0].ctl);
		expect(points[0].tsb).toBeLessThan(0);
	});

	it('gir tom serie for tom input', () => {
		expect(computeTrainingLoad([])).toEqual([]);
	});
});
