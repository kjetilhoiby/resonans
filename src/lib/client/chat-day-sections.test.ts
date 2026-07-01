import { describe, it, expect } from 'vitest';
import {
	toDate,
	isSameDay,
	formatDayLabel,
	daySpacerBefore,
	type DayAware
} from './chat-day-sections';

// Tester kjører med TZ=UTC (se vitest.config.ts).
const NOW = new Date(2026, 6, 1, 12, 0, 0); // 1. juli 2026, lokal tid

describe('toDate', () => {
	it('parser Date, ISO-streng og avviser tomt/ugyldig', () => {
		const d = new Date(2026, 5, 25);
		expect(toDate(d)).toBe(d);
		expect(toDate('2026-06-25T10:00:00Z')?.getUTCFullYear()).toBe(2026);
		expect(toDate(null)).toBeNull();
		expect(toDate(undefined)).toBeNull();
		expect(toDate('')).toBeNull();
		expect(toDate('ikke en dato')).toBeNull();
	});
});

describe('isSameDay', () => {
	it('skiller kalenderdager', () => {
		expect(isSameDay(new Date(2026, 5, 25, 1), new Date(2026, 5, 25, 23))).toBe(true);
		expect(isSameDay(new Date(2026, 5, 25), new Date(2026, 5, 26))).toBe(false);
	});
});

describe('formatDayLabel', () => {
	it('gir «I dag» og «I går»', () => {
		expect(formatDayLabel(new Date(2026, 6, 1, 8, 0), NOW)).toBe('I dag');
		expect(formatDayLabel(new Date(2026, 5, 30, 8, 0), NOW)).toBe('I går');
	});

	it('gir stor forbokstav og «dag DD. måned» for eldre datoer samme år', () => {
		const label = formatDayLabel(new Date(2026, 5, 25), NOW);
		expect(label).toContain('25. juni');
		expect(label[0]).toBe(label[0].toUpperCase());
		expect(label).not.toContain('2026'); // år utelates samme år
	});

	it('tar med år når det avviker fra now', () => {
		const label = formatDayLabel(new Date(2025, 11, 31), NOW);
		expect(label).toContain('2025');
		expect(label).toContain('31. desember');
	});
});

describe('daySpacerBefore', () => {
	it('viser dag-overskrift øverst i tråden', () => {
		const msgs: DayAware[] = [{ createdAt: new Date(2026, 6, 1, 9) }];
		expect(daySpacerBefore(msgs, 0, NOW)).toBe('I dag');
	});

	it('setter spacer kun ved dagskifte', () => {
		const msgs: DayAware[] = [
			{ createdAt: new Date(2026, 5, 30, 9) }, // i går
			{ createdAt: new Date(2026, 5, 30, 21) }, // samme dag
			{ createdAt: new Date(2026, 6, 1, 8) } // i dag
		];
		expect(daySpacerBefore(msgs, 0, NOW)).toBe('I går');
		expect(daySpacerBefore(msgs, 1, NOW)).toBeNull();
		expect(daySpacerBefore(msgs, 2, NOW)).toBe('I dag');
	});

	it('gir ingen spacer for meldinger uten tidsstempel', () => {
		const msgs: DayAware[] = [{ text: 'a' } as DayAware, { createdAt: null }];
		expect(daySpacerBefore(msgs, 0, NOW)).toBeNull();
		expect(daySpacerBefore(msgs, 1, NOW)).toBeNull();
	});

	it('unngår tilfeldig skille midt i strømmen når forrige mangler tidsstempel', () => {
		const msgs: DayAware[] = [{ createdAt: null }, { createdAt: new Date(2026, 6, 1, 8) }];
		expect(daySpacerBefore(msgs, 1, NOW)).toBeNull();
	});
});
