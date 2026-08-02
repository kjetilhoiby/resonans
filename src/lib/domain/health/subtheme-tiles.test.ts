import { describe, it, expect } from 'vitest';
import { buildSubthemeTiles, type SubthemeTileInput } from './subtheme-tiles';
import { HEALTH_SUBTHEME_NAMES } from '$lib/domain/health-subthemes';

function input(overrides: Partial<SubthemeTileInput> = {}): SubthemeTileInput {
	return { themeIdsByName: {}, ...overrides };
}

function tile(tiles: ReturnType<typeof buildSubthemeTiles>, name: string) {
	return tiles.find((t) => t.name === name)!;
}

describe('buildSubthemeTiles — struktur', () => {
	it('gir alltid fem fliser i fast rekkefølge', () => {
		const tiles = buildSubthemeTiles(input());
		expect(tiles.map((t) => t.name)).toEqual(HEALTH_SUBTHEME_NAMES);
	});

	it('markerer fliser uten data som tomme, men beholder dem', () => {
		const tiles = buildSubthemeTiles(input());
		expect(tiles.every((t) => t.empty)).toBe(true);
		expect(tiles.every((t) => t.value === null)).toBe(true);
	});

	it('kobler på themeId der undertemaet finnes, ellers null', () => {
		const tiles = buildSubthemeTiles(input({ themeIdsByName: { Søvn: 'uuid-sovn' } }));
		expect(tile(tiles, 'Søvn').themeId).toBe('uuid-sovn');
		expect(tile(tiles, 'Trening').themeId).toBeNull();
	});
});

describe('buildSubthemeTiles — Trening', () => {
	it('viser ukens effort med avvik fra fireukerssnittet', () => {
		const t = tile(
			buildSubthemeTiles(input({ weeklyEffort: { total: 412.4, baseline: { delta: 37 } } })),
			'Trening'
		);
		expect(t.value).toBe('412');
		expect(t.unit).toBe('effort');
		expect(t.delta).toBe('+37 mot snittet');
		expect(t.tone).toBe('positiv');
	});

	it('varsler ved markant fall, ikke ved smånedgang', () => {
		expect(
			tile(buildSubthemeTiles(input({ weeklyEffort: { total: 100, baseline: { delta: -45 } } })), 'Trening').tone
		).toBe('varsel');
		expect(
			tile(buildSubthemeTiles(input({ weeklyEffort: { total: 100, baseline: { delta: -5 } } })), 'Trening').tone
		).toBe('nøytral');
	});

	it('viser tallet uten delta når baseline mangler', () => {
		const t = tile(buildSubthemeTiles(input({ weeklyEffort: { total: 200 } })), 'Trening');
		expect(t.value).toBe('200');
		expect(t.delta).toBeNull();
		expect(t.empty).toBe(false);
	});
});

describe('buildSubthemeTiles — Ernæring', () => {
	it('bruker norsk minustegn og komma på vektendring', () => {
		const t = tile(buildSubthemeTiles(input({ weightChange30d: -1.4 })), 'Ernæring');
		expect(t.value).toBe('−1,4');
		expect(t.unit).toBe('kg');
		expect(t.tone).toBe('positiv');
	});

	it('regner oppgang som nøytral — vi kjenner ikke intensjonen', () => {
		expect(tile(buildSubthemeTiles(input({ weightChange30d: 1.2 })), 'Ernæring').tone).toBe('nøytral');
	});

	it('behandler 0 som en verdi, ikke som manglende data', () => {
		const t = tile(buildSubthemeTiles(input({ weightChange30d: 0 })), 'Ernæring');
		expect(t.empty).toBe(false);
		expect(t.value).toBe('0,0');
	});
});

describe('buildSubthemeTiles — Søvn', () => {
	it('varsler ved for lite søvn — motsatt av vekt og skjermtid', () => {
		// Fortegns-asymmetrien: mindre er bra for vekt/skjermtid, dårlig for søvn.
		expect(tile(buildSubthemeTiles(input({ sleepAvgHours: 5.8 })), 'Søvn').tone).toBe('varsel');
		expect(tile(buildSubthemeTiles(input({ sleepAvgHours: 7.6 })), 'Søvn').tone).toBe('positiv');
		expect(tile(buildSubthemeTiles(input({ sleepAvgHours: 6.8 })), 'Søvn').tone).toBe('nøytral');
	});

	it('formaterer timer med komma', () => {
		expect(tile(buildSubthemeTiles(input({ sleepAvgHours: 7.25 })), 'Søvn').value).toBe('7,3');
	});
});

describe('buildSubthemeTiles — Skjermtid', () => {
	it('varsler ved mye skjerm, roser ved lite', () => {
		expect(tile(buildSubthemeTiles(input({ screenTimeAvgPerDayMinutes: 300 })), 'Skjermtid').tone).toBe('varsel');
		expect(tile(buildSubthemeTiles(input({ screenTimeAvgPerDayMinutes: 95 })), 'Skjermtid').tone).toBe('positiv');
	});

	it('formaterer minutter som timer og minutter', () => {
		expect(tile(buildSubthemeTiles(input({ screenTimeAvgPerDayMinutes: 195 })), 'Skjermtid').value).toBe('3 t 15 min');
		expect(tile(buildSubthemeTiles(input({ screenTimeAvgPerDayMinutes: 45 })), 'Skjermtid').value).toBe('45 min');
	});
});

describe('buildSubthemeTiles — Egenfrekvens', () => {
	it('viser nivå av 5 med retning', () => {
		const t = tile(
			buildSubthemeTiles(input({ egenfrekvens: { recentAvg: 2.8, direction: 'nedgang' } })),
			'Egenfrekvens'
		);
		expect(t.value).toBe('2,8');
		expect(t.unit).toBe('av 5');
		expect(t.delta).toBe('nedgang');
		expect(t.tone).toBe('varsel');
	});

	it('lar oppgang være positiv og stabil være nøytral', () => {
		expect(
			tile(buildSubthemeTiles(input({ egenfrekvens: { recentAvg: 4, direction: 'oppgang' } })), 'Egenfrekvens').tone
		).toBe('positiv');
		expect(
			tile(buildSubthemeTiles(input({ egenfrekvens: { recentAvg: 3.4, direction: 'stabil' } })), 'Egenfrekvens').tone
		).toBe('nøytral');
	});
});
