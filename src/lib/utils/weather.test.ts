import { describe, it, expect } from 'vitest';
import { wmoToEmoji, parseOpenMeteoDay, openMeteoBaseUrl } from './weather';

describe('wmoToEmoji', () => {
	it('mapper klarvær og skydekke', () => {
		expect(wmoToEmoji(0)).toBe('☀️');
		expect(wmoToEmoji(1)).toBe('🌤️');
		expect(wmoToEmoji(2)).toBe('⛅');
		expect(wmoToEmoji(3)).toBe('☁️');
	});

	it('mapper tåke, regn, snø og torden', () => {
		expect(wmoToEmoji(45)).toBe('🌫️');
		expect(wmoToEmoji(61)).toBe('🌧️');
		expect(wmoToEmoji(80)).toBe('🌧️');
		expect(wmoToEmoji(71)).toBe('❄️');
		expect(wmoToEmoji(86)).toBe('❄️');
		expect(wmoToEmoji(95)).toBe('⛈️');
	});

	it('faller tilbake til termometer for ukjent kode', () => {
		expect(wmoToEmoji(999)).toBe('🌡️');
	});
});

describe('parseOpenMeteoDay', () => {
	it('plukker første dag og runder temperaturen', () => {
		const data = { daily: { weather_code: [3], temperature_2m_max: [17.6] } };
		expect(parseOpenMeteoDay(data)).toEqual({ emoji: '☁️', temp: 18 });
	});

	it('returnerer null når data mangler', () => {
		expect(parseOpenMeteoDay(null)).toBeNull();
		expect(parseOpenMeteoDay({})).toBeNull();
		expect(parseOpenMeteoDay({ daily: { weather_code: [], temperature_2m_max: [] } })).toBeNull();
	});
});

describe('openMeteoBaseUrl', () => {
	const today = '2026-06-23';

	it('bruker forecast-API for de siste dagene (innenfor arkiv-etterslepet)', () => {
		expect(openMeteoBaseUrl('2026-06-23', today)).toContain('/v1/forecast');
		expect(openMeteoBaseUrl('2026-06-20', today)).toContain('/v1/forecast');
		expect(openMeteoBaseUrl('2026-06-18', today)).toContain('/v1/forecast');
	});

	it('bruker arkiv-API for eldre datoer', () => {
		expect(openMeteoBaseUrl('2026-06-17', today)).toContain('/v1/archive');
		expect(openMeteoBaseUrl('2026-01-01', today)).toContain('/v1/archive');
	});
});
