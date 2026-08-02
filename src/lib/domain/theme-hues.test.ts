import { describe, it, expect } from 'vitest';
import { getThemeHueKey, getThemeHue, THEME_HUES } from './theme-hues';

describe('getThemeHueKey — helse-familien', () => {
	it('gir mortemaet og alle fem undertemaene samme hue', () => {
		for (const name of ['Helse', 'Trening', 'Ernæring', 'Egenfrekvens', 'Søvn', 'Skjermtid']) {
			expect(getThemeHueKey(name), name).toBe('health');
		}
	});

	it('matcher norske tegn som ikke dekomponeres (ø og æ)', () => {
		// «ø» og «æ» har ingen kanonisk dekomponering, så en ASCII-skrevet term
		// ville aldri truffet disse navnene. Regresjonsvern for den buggen.
		expect(getThemeHueKey('Søvn')).toBe('health');
		expect(getThemeHueKey('Løping')).toBe('health');
		expect(getThemeHueKey('Ernæring')).toBe('health');
		expect(getThemeHueKey('Økonomi')).toBe('economy');
		expect(getThemeHueKey('Bøker')).toBe('literature');
	});

	it('matcher «å» både med og uten dekomponering', () => {
		// «å» dekomponerer til «a», så begge skrivemåter må treffe samme sted.
		expect(getThemeHueKey('Måltid')).toBe(getThemeHueKey('Maltid'));
	});
});

describe('getThemeHueKey — ordgrense for korte termer', () => {
	it('lar ikke en kort term matche inni et lengre ord', () => {
		// «ro» (reflection) matchet tidligere «Kropp» som delstreng.
		expect(getThemeHueKey('Kropp')).toBe('health');
	});

	it('matcher fortsatt korte termer som eget ord', () => {
		expect(getThemeHueKey('Bok')).toBe('literature');
		expect(getThemeHueKey('Barn')).toBe('family');
	});
});

describe('getThemeHueKey — øvrige domener', () => {
	it('kjenner igjen de andre kategoriene', () => {
		expect(getThemeHueKey('Samliv')).toBe('relations');
		expect(getThemeHueKey('Familie')).toBe('family');
		expect(getThemeHueKey('Jobb')).toBe('work');
		expect(getThemeHueKey('Refleksjon')).toBe('reflection');
	});

	it('faller til default for ukjente navn', () => {
		expect(getThemeHueKey('Sommerferie 2026')).toBe('default');
		expect(getThemeHueKey('')).toBe('default');
		expect(getThemeHueKey(null)).toBe('default');
		expect(getThemeHueKey(undefined)).toBe('default');
	});
});

describe('getThemeHue', () => {
	it('returnerer tallverdien for nøkkelen', () => {
		expect(getThemeHue('Helse')).toBe(THEME_HUES.health);
		expect(getThemeHue('Ukjent tema')).toBe(THEME_HUES.default);
	});
});
