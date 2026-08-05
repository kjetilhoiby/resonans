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
	it('gir én flis per undertema i fast rekkefølge', () => {
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
	it('viser loggede kalorier med protein og antall dager', () => {
		const t = tile(
			buildSubthemeTiles(input({ nutrition: { kcalPerDay: 2140, proteinPerDay: 118, loggedDays: 5 } })),
			'Ernæring'
		);
		// nb-NO skiller tusener med hardt mellomrom (U+00A0), ikke vanlig mellomrom.
		expect(t.value).toBe('2\u00a0140');
		expect(t.unit).toBe('kcal/dag');
		expect(t.delta).toBe('118 g protein · 5 dager');
	});

	it('faller ikke tilbake på vekta — den har sin egen flis nå', () => {
		// To naboliggende fliser med samme tall gjør stripen vanskeligere å lese.
		const t = tile(buildSubthemeTiles(input({ weightChange30d: -1.4 })), 'Ernæring');
		expect(t.empty).toBe(true);
		expect(t.value).toBeNull();
	});

	it('gir ingen tone på inntak — vi har ingen terskel å dømme etter', () => {
		expect(
			tile(buildSubthemeTiles(input({ nutrition: { kcalPerDay: 900, loggedDays: 3 } })), 'Ernæring')
				.tone
		).toBe('nøytral');
	});
});

describe('buildSubthemeTiles — Vekt', () => {
	it('leder med nivået og setter endringen som undertekst', () => {
		const t = tile(buildSubthemeTiles(input({ weightKg: 82.4, weightChange30d: -1.4 })), 'Vekt');
		expect(t.value).toBe('82,4');
		expect(t.unit).toBe('kg');
		expect(t.delta).toBe('−1,4 kg på 30 dager');
		expect(t.tone).toBe('positiv');
	});

	it('regner oppgang som nøytral — vi kjenner ikke intensjonen', () => {
		expect(tile(buildSubthemeTiles(input({ weightKg: 82.4, weightChange30d: 1.2 })), 'Vekt').tone).toBe(
			'nøytral'
		);
	});

	it('viser endringen alene når siste veiing mangler', () => {
		const t = tile(buildSubthemeTiles(input({ weightChange30d: -1.4 })), 'Vekt');
		expect(t.value).toBe('−1,4');
		expect(t.empty).toBe(false);
	});

	it('behandler 0 som en verdi, ikke som manglende data', () => {
		const t = tile(buildSubthemeTiles(input({ weightChange30d: 0 })), 'Vekt');
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


describe('buildSubthemeTiles — Søvn og urolige netter', () => {
	function sleepTile(input: Partial<SubthemeTileInput>) {
		return buildSubthemeTiles({ themeIdsByName: {}, ...input }).find((t) => t.name === 'Søvn')!;
	}

	it('viser antall urolige netter i stedet for «siste uke»', () => {
		const tile = sleepTile({ sleepAvgHours: 7.2, sleepDisturbedNights: 3 });
		expect(tile.delta).toBe('3 urolige netter');
	});

	it('bøyer natt i entall', () => {
		expect(sleepTile({ sleepAvgHours: 7.2, sleepDisturbedNights: 1 }).delta).toBe('1 urolig natt');
	});

	it('lar to urolige netter overstyre en god varighet', () => {
		// Sju timer der to netter var våkenliggende er ikke sju gode timer.
		expect(sleepTile({ sleepAvgHours: 7.5, sleepDisturbedNights: 0 }).tone).toBe('positiv');
		expect(sleepTile({ sleepAvgHours: 7.5, sleepDisturbedNights: 2 }).tone).toBe('varsel');
	});

	it('demper én urolig natt til nøytral framfor varsel', () => {
		expect(sleepTile({ sleepAvgHours: 7.5, sleepDisturbedNights: 1 }).tone).toBe('nøytral');
	});

	it('lar kort søvn fortsatt være varsel uten forstyrrelser', () => {
		expect(sleepTile({ sleepAvgHours: 6.0, sleepDisturbedNights: 0 }).tone).toBe('varsel');
	});

	it('faller tilbake på antall urolige netter når varigheten mangler', () => {
		// En bruker uten Withings som logger manuelt skal ikke se en tom flis.
		const tile = sleepTile({ sleepAvgHours: null, sleepDisturbedNights: 2 });
		expect(tile.empty).toBe(false);
		expect(tile.value).toBe('2');
		expect(tile.unit).toBe('urolige netter');
		expect(tile.tone).toBe('varsel');
	});

	it('er fortsatt tom uten både varighet og forstyrrelser', () => {
		expect(sleepTile({ sleepAvgHours: null }).empty).toBe(true);
	});

	it('oppfører seg som før når forstyrrelser mangler', () => {
		const tile = sleepTile({ sleepAvgHours: 7.2 });
		expect(tile.delta).toBe('siste uke');
		expect(tile.tone).toBe('positiv');
	});
});
