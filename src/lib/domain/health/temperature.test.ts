import { describe, it, expect } from 'vitest';
import {
	MIN_SKIN_BASELINE_NIGHTS,
	SKIN_NOISE_C,
	describeCoreTemperature,
	describeSkinTemperature,
	isPlausibleTemperature,
	kindForMeastype,
	summarizeCoreTemperature,
	summarizeSkinTemperature,
	type TemperatureReading
} from './temperature';

const r = (date: string, celsius: number): TemperatureReading => ({ date, celsius });

describe('kindForMeastype', () => {
	it('73 er hud, 71 og 12 er kjerne', () => {
		expect(kindForMeastype(73)).toBe('skin');
		expect(kindForMeastype(71)).toBe('core');
		expect(kindForMeastype(12)).toBe('core');
	});

	it('ukjent måletype gir null framfor en gjetning', () => {
		expect(kindForMeastype(1)).toBeNull();
		expect(kindForMeastype(123)).toBeNull();
	});
});

describe('isPlausibleTemperature', () => {
	it('avviser Fahrenheit og romtemperatur', () => {
		// 98,6 °F er den åpenbare feilen nettet finnes for.
		expect(isPlausibleTemperature('core', 98.6)).toBe(false);
		expect(isPlausibleTemperature('core', 21)).toBe(false);
	});

	it('godtar en febermåling og en normal kjerne', () => {
		expect(isPlausibleTemperature('core', 38.9)).toBe(true);
		expect(isPlausibleTemperature('core', 36.6)).toBe(true);
	});

	it('hud får et lavere gulv — håndleddet er kaldere enn kjernen', () => {
		expect(isPlausibleTemperature('skin', 33.2)).toBe(true);
		expect(isPlausibleTemperature('skin', 24)).toBe(true);
		expect(isPlausibleTemperature('core', 24)).toBe(false);
	});
});

describe('summarizeCoreTemperature', () => {
	it('holder absolutte tall og finner høyeste i perioden', () => {
		const s = summarizeCoreTemperature([
			r('2026-09-01', 37.4),
			r('2026-09-02', 38.9),
			r('2026-09-03', 37.9)
		]);
		expect(s.latest?.celsius).toBe(37.9);
		expect(s.highest?.celsius).toBe(38.9);
		expect(s.highest?.date).toBe('2026-09-02');
	});

	it('ved likhet vinner den seneste — den beskriver nå', () => {
		const s = summarizeCoreTemperature([r('2026-09-01', 38.5), r('2026-09-03', 38.5)]);
		expect(s.highest?.date).toBe('2026-09-03');
	});
});

describe('summarizeSkinTemperature', () => {
	const week = Array.from({ length: 8 }, (_, i) =>
		r(`2026-09-${String(i + 1).padStart(2, '0')}`, 33.0)
	);

	it('holder kjeft før baselinen finnes', () => {
		const s = summarizeSkinTemperature(week.slice(0, 3));
		expect(s.deviationC).toBeNull();
		expect(s.band).toBe('ukjent');
		expect(s.baselineNights).toBe(2);
	});

	it('regner avvik mot egen median, uten siste måling', () => {
		const s = summarizeSkinTemperature([...week.slice(0, 7), r('2026-09-08', 33.8)]);
		expect(s.baselineC).toBe(33);
		expect(s.deviationC).toBe(0.8);
		expect(s.band).toBe('over');
	});

	it('under støygulvet er «som vanlig»', () => {
		const s = summarizeSkinTemperature([
			...week.slice(0, 7),
			r('2026-09-08', 33 + SKIN_NOISE_C)
		]);
		expect(s.band).toBe('normal');
	});

	it('krever MIN_SKIN_BASELINE_NIGHTS tidligere netter', () => {
		const s = summarizeSkinTemperature(week.slice(0, MIN_SKIN_BASELINE_NIGHTS));
		expect(s.deviationC).toBeNull();
		const ok = summarizeSkinTemperature(week.slice(0, MIN_SKIN_BASELINE_NIGHTS + 1));
		expect(ok.deviationC).not.toBeNull();
	});
});

describe('ordene', () => {
	it('kjerne oppgis absolutt, uten en dom', () => {
		const text = describeCoreTemperature(
			summarizeCoreTemperature([r('2026-09-02', 38.9), r('2026-09-03', 37.6)])
		)!;
		expect(text).toBe('37,6 °C (høyeste i perioden 38,9 °C)');
		// Ingen diagnose: vi måler en sensor, vi vurderer ikke brukeren.
		// («høyeste» er en faktisk superlativ, ikke en dom — derfor ordgrenser.)
		expect(text).not.toMatch(/\bfeber|\bforhøyet|\bbør\b|\bhvil|\blege\b/i);
	});

	it('hud oppgis som avvik, ALDRI som et absolutt tall alene', () => {
		const week = Array.from({ length: 7 }, (_, i) =>
			r(`2026-09-${String(i + 1).padStart(2, '0')}`, 33.0)
		);
		const text = describeSkinTemperature(
			summarizeSkinTemperature([...week, r('2026-09-08', 33.8)])
		)!;
		expect(text).toBe('Hudtemperatur 0,8 °C over ditt eget snitt');
		expect(text).not.toContain('33,8');
	});

	it('uten baseline sier den hvorfor, framfor å vise et tall uten mening', () => {
		const text = describeSkinTemperature(summarizeSkinTemperature([r('2026-09-01', 33.2)]))!;
		expect(text).toContain('netter til');
		expect(text).not.toContain('33,2');
	});
});
