import { describe, it, expect } from 'vitest';
import {
	isFerieActiveOn,
	ferieOverlaps,
	activeFerieThemes,
	FERIE_FALLBACK_EMOJI
} from './active-ferie';

describe('isFerieActiveOn', () => {
	const vindu = { startDate: '2026-07-01', endDate: '2026-07-14' };

	it('er sann på første og siste dag (inklusiv)', () => {
		expect(isFerieActiveOn(vindu, '2026-07-01')).toBe(true);
		expect(isFerieActiveOn(vindu, '2026-07-14')).toBe(true);
	});

	it('er sann midt i vinduet', () => {
		expect(isFerieActiveOn(vindu, '2026-07-08')).toBe(true);
	});

	it('er usann før og etter vinduet', () => {
		expect(isFerieActiveOn(vindu, '2026-06-30')).toBe(false);
		expect(isFerieActiveOn(vindu, '2026-07-15')).toBe(false);
	});

	it('er usann når datoer mangler', () => {
		expect(isFerieActiveOn(null, '2026-07-08')).toBe(false);
		expect(isFerieActiveOn({ startDate: '2026-07-01' }, '2026-07-08')).toBe(false);
		expect(isFerieActiveOn({}, '2026-07-08')).toBe(false);
	});
});

describe('ferieOverlaps', () => {
	const vindu = { startDate: '2026-07-06', endDate: '2026-07-12' };

	it('overlapper når uka inneholder vinduet helt eller delvis', () => {
		expect(ferieOverlaps(vindu, '2026-07-06', '2026-07-12')).toBe(true); // samme uke
		expect(ferieOverlaps(vindu, '2026-07-01', '2026-07-07')).toBe(true); // delvis start
		expect(ferieOverlaps(vindu, '2026-07-12', '2026-07-18')).toBe(true); // delvis slutt
	});

	it('overlapper ikke uker før eller etter', () => {
		expect(ferieOverlaps(vindu, '2026-06-29', '2026-07-05')).toBe(false);
		expect(ferieOverlaps(vindu, '2026-07-13', '2026-07-19')).toBe(false);
	});

	it('er usann når datoer mangler', () => {
		expect(ferieOverlaps(null, '2026-07-06', '2026-07-12')).toBe(false);
	});
});

describe('activeFerieThemes', () => {
	const sommerferie = {
		id: 't1',
		name: 'Sommerferie',
		emoji: '☀️',
		ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-14' }
	};
	const helse = {
		id: 't2',
		name: 'Helse',
		emoji: '💪',
		ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-14' }
	};
	const planlagtFerie = {
		id: 't3',
		name: 'Høstferie',
		emoji: null,
		ferieProfile: { startDate: '2026-10-01', endDate: '2026-10-07' }
	};

	it('plukker bare ferie-temaer med overlappende vindu', () => {
		const aktive = activeFerieThemes([sommerferie, helse, planlagtFerie], '2026-07-08', '2026-07-08');
		expect(aktive.map((f) => f.id)).toEqual(['t1']);
	});

	it('utelukker ikke-ferie-temaer selv om vinduet overlapper', () => {
		// Helse har et ferieProfile-vindu, men er ikke et ferie-tema → skal ikke med.
		const aktive = activeFerieThemes([helse], '2026-07-08', '2026-07-08');
		expect(aktive).toHaveLength(0);
	});

	it('bruker fallback-emoji når temaet mangler emoji', () => {
		const aktive = activeFerieThemes([planlagtFerie], '2026-10-03', '2026-10-03');
		expect(aktive[0].emoji).toBe(FERIE_FALLBACK_EMOJI);
	});

	it('returnerer vinduet for dag-merking', () => {
		const aktive = activeFerieThemes([sommerferie], '2026-07-08', '2026-07-08');
		expect(aktive[0]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-14' });
	});
});
