import { describe, it, expect } from 'vitest';
import {
	resolveFullSyncFloor,
	fullSyncFloorSeconds,
	isValidFloor,
	WITHINGS_FULL_SYNC_DEFAULT_FLOOR,
	WITHINGS_EARLIEST_PLAUSIBLE_FLOOR
} from './withings-sync-window';

describe('isValidFloor', () => {
	it('godtar YYYY-MM-DD', () => {
		expect(isValidFloor('2014-01-01')).toBe(true);
	});

	it('avviser alt annet', () => {
		for (const bad of [null, undefined, '', '2014', '01-01-2014', 'i fjor', '2014-1-1']) {
			expect(isValidFloor(bad), String(bad)).toBe(false);
		}
	});
});

describe('resolveFullSyncFloor', () => {
	it('slipper gjennom en dato brukeren oppgir', () => {
		// Kjernen i endringen: 2014 skal være nåbart. Var hardkodet til 2017 på fem
		// steder, og datoen sto også i navnet på query-parameteren (`from2017`).
		expect(resolveFullSyncFloor('2014-03-01')).toBe('2014-03-01');
	});

	it('faller tilbake på defaulten for ugyldig inndata', () => {
		// Kaster ikke: kallstedene er synkfunksjoner, og en skrivefeil i en
		// query-param skal ikke kunne velte en synk. Endepunktet svarer 400 separat.
		expect(resolveFullSyncFloor('tull')).toBe(WITHINGS_FULL_SYNC_DEFAULT_FLOOR);
		expect(resolveFullSyncFloor(null)).toBe(WITHINGS_FULL_SYNC_DEFAULT_FLOOR);
	});

	it('klipper en dato før Withings fantes', () => {
		// «0214-01-01» er en skrivefeil for 2014, ikke en forespørsel om middelalderen.
		expect(resolveFullSyncFloor('0214-01-01')).toBe(WITHINGS_EARLIEST_PLAUSIBLE_FLOOR);
		expect(resolveFullSyncFloor('1990-01-01')).toBe(WITHINGS_EARLIEST_PLAUSIBLE_FLOOR);
	});

	it('lar defaulten være innenfor det plausible', () => {
		expect(WITHINGS_FULL_SYNC_DEFAULT_FLOOR > WITHINGS_EARLIEST_PLAUSIBLE_FLOOR).toBe(true);
	});
});

describe('fullSyncFloorSeconds', () => {
	it('gir sekunder siden epoken', () => {
		expect(fullSyncFloorSeconds('2014-01-01')).toBe(Date.UTC(2014, 0, 1) / 1000);
	});

	it('bruker samme klipping som resolveFullSyncFloor', () => {
		expect(fullSyncFloorSeconds('1990-01-01')).toBe(
			fullSyncFloorSeconds(WITHINGS_EARLIEST_PLAUSIBLE_FLOOR)
		);
	});
});
