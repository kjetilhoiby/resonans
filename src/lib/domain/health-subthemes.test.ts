import { describe, it, expect } from 'vitest';
import {
	HEALTH_PARENT_THEME_NAME,
	HEALTH_SUBTHEMES,
	HEALTH_SUBTHEME_NAMES,
	HEALTH_FAMILY_KINDS,
	findHealthSubthemeByKind,
	isHealthSubthemeName
} from './health-subthemes';
import { resolveThemeDashboardKind } from './theme-dashboard-registry';

describe('HEALTH_SUBTHEMES', () => {
	it('holder de fem undertemaene', () => {
		expect(HEALTH_SUBTHEME_NAMES).toEqual([
			'Trening',
			'Ernæring',
			'Egenfrekvens',
			'Søvn',
			'Skjermtid'
		]);
	});

	it('har unike navn og unike dashboardtyper', () => {
		expect(new Set(HEALTH_SUBTHEME_NAMES).size).toBe(HEALTH_SUBTHEMES.length);
		expect(new Set(HEALTH_SUBTHEMES.map((s) => s.kind)).size).toBe(HEALTH_SUBTHEMES.length);
	});

	it('gir hvert undertemanavn nøyaktig den dashboardtypen det er registrert med', () => {
		// Kontrakten hele hierarkiet hviler på: navnet må resolve til riktig
		// kind, ellers får undertemaet feil dashboard eller ingen Data-fane.
		for (const subtheme of HEALTH_SUBTHEMES) {
			expect(resolveThemeDashboardKind(subtheme.name), subtheme.name).toBe(subtheme.kind);
		}
	});

	it('lar mortemanavnet resolve til health', () => {
		expect(resolveThemeDashboardKind(HEALTH_PARENT_THEME_NAME)).toBe('health');
	});

	it('lar ingen undertema kollidere med mortemaet', () => {
		for (const subtheme of HEALTH_SUBTHEMES) {
			expect(subtheme.kind).not.toBe('health');
		}
	});

	it('gir hvert undertema en emoji og en beskrivelse', () => {
		for (const subtheme of HEALTH_SUBTHEMES) {
			expect(subtheme.emoji, subtheme.name).toBeTruthy();
			expect(subtheme.description, subtheme.name).toBeTruthy();
		}
	});
});

describe('HEALTH_FAMILY_KINDS', () => {
	it('inneholder mortemaet og alle undertemaene', () => {
		expect(HEALTH_FAMILY_KINDS).toEqual([
			'health',
			'training',
			'nutrition',
			'egenfrekvens',
			'sleep',
			'screentime'
		]);
	});
});

describe('findHealthSubthemeByKind', () => {
	it('finner undertemaet for en kind', () => {
		expect(findHealthSubthemeByKind('sleep')?.name).toBe('Søvn');
	});

	it('returnerer null for mortemaet og for ukjente typer', () => {
		expect(findHealthSubthemeByKind('health')).toBeNull();
		expect(findHealthSubthemeByKind('economics')).toBeNull();
		expect(findHealthSubthemeByKind(null)).toBeNull();
	});
});

describe('isHealthSubthemeName', () => {
	it('kjenner igjen undertemanavn eksakt', () => {
		expect(isHealthSubthemeName('Trening')).toBe(true);
		expect(isHealthSubthemeName('Søvn')).toBe(true);
	});

	it('avviser mortemaet, feil kasus og tomme verdier', () => {
		expect(isHealthSubthemeName('Helse')).toBe(false);
		expect(isHealthSubthemeName('trening')).toBe(false);
		expect(isHealthSubthemeName(null)).toBe(false);
		expect(isHealthSubthemeName(undefined)).toBe(false);
	});
});
