import { describe, it, expect } from 'vitest';
import { normalizeWeekPlanItems } from './week-plan-items';

describe('normalizeWeekPlanItems', () => {
	it('godtar gamle strengpunkter', () => {
		expect(normalizeWeekPlanItems(['Skjermfri 16–19 tre kvelder', '  Løpe 5 km  '])).toEqual([
			{ text: 'Skjermfri 16–19 tre kvelder', dimension: null },
			{ text: 'Løpe 5 km', dimension: null }
		]);
	});

	it('godtar objektpunkter med gyldig livskompass-dimensjon', () => {
		expect(normalizeWeekPlanItems([{ text: 'Skjermfri 16–19 tre kvelder', dimension: 'egentid' }])).toEqual([
			{ text: 'Skjermfri 16–19 tre kvelder', dimension: 'egentid' }
		]);
	});

	it('dropper ukjent dimensjons-id stille (hallusinert id blir vanlig punkt)', () => {
		expect(normalizeWeekPlanItems([{ text: 'Lese mer', dimension: 'lesing' }])).toEqual([
			{ text: 'Lese mer', dimension: null }
		]);
	});

	it('filtrerer bort tomme og ugyldige punkter', () => {
		expect(
			normalizeWeekPlanItems(['', '   ', null, undefined, { text: '' }, { dimension: 'egentid' }, 42 as never])
		).toEqual([]);
	});

	it('blander strenger og objekter i samme kall', () => {
		expect(
			normalizeWeekPlanItems(['Handle inn søndag', { text: 'Kveldstur to ganger', dimension: 'natur' }])
		).toEqual([
			{ text: 'Handle inn søndag', dimension: null },
			{ text: 'Kveldstur to ganger', dimension: 'natur' }
		]);
	});
});
