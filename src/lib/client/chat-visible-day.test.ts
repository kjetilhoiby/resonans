import { describe, it, expect } from 'vitest';
import { currentDayFromSpacers, type SpacerPos } from './chat-visible-day';

const spacers: SpacerPos[] = [
	{ key: '2026-07-01', top: -400 },
	{ key: '2026-07-02', top: -50 },
	{ key: '2026-07-03', top: 300 },
	{ key: '2026-07-04', top: 900 }
];

describe('currentDayFromSpacers', () => {
	it('velger siste spacer over headerlinjen', () => {
		expect(currentDayFromSpacers(spacers, 100)).toBe('2026-07-02');
		expect(currentDayFromSpacers(spacers, 350)).toBe('2026-07-03');
	});

	it('faller tilbake til første spacer når ingen har passert headeren', () => {
		expect(currentDayFromSpacers(spacers, -500)).toBe('2026-07-01');
	});

	it('gir siste dag når alt er scrollet forbi', () => {
		expect(currentDayFromSpacers(spacers, 2000)).toBe('2026-07-04');
	});

	it('tom liste gir null', () => {
		expect(currentDayFromSpacers([], 100)).toBeNull();
	});
});
