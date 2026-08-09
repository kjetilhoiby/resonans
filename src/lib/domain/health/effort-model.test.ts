import { describe, it, expect } from 'vitest';
import {
	CALIBRATION_REFERENCE_HRR,
	classifyEffortFamily,
	MET_CALIBRATION,
	MET_FACTOR_BY_FAMILY,
	trimpPerMinute
} from './effort-model';

describe('trimpPerMinute', () => {
	it('vokser eksponentielt med intensiteten', () => {
		// Poenget med kurven: feil i HRR forsterkes. Et sprang på 0,1 i HRR koster
		// mer enn 0,1 lineært ville gjort — derfor er makspulskilden en større sak
		// enn den ser ut som.
		const lav = trimpPerMinute(0.6) - trimpPerMinute(0.5);
		const høy = trimpPerMinute(0.9) - trimpPerMinute(0.8);
		expect(høy).toBeGreaterThan(lav * 2);
	});

	it('er 0 ved hvile', () => {
		expect(trimpPerMinute(0)).toBe(0);
	});
});

describe('MET_CALIBRATION', () => {
	it('lar et løpeminutt koste det samme uansett hvilken sti det gikk gjennom', () => {
		// Selve kontrakten: en økt uten puls skal ikke prises annerledes enn den
		// samme økta med puls. Hardkodet 2,5 svarte til HRR ≈ 0,82 — altså langt
		// hardere enn en rolig økt — og var i praksis tunet mot en for lav makspuls.
		const trimpVedReferanse = trimpPerMinute(CALIBRATION_REFERENCE_HRR);
		const metVedReferanse = MET_FACTOR_BY_FAMILY.running * MET_CALIBRATION;
		expect(metVedReferanse).toBeCloseTo(trimpVedReferanse, 1);
	});

	it('ligger på et nivå en rolig-til-moderat økt faktisk holder', () => {
		expect(CALIBRATION_REFERENCE_HRR).toBeGreaterThan(0.6);
		expect(CALIBRATION_REFERENCE_HRR).toBeLessThan(0.85);
	});
});

describe('MET_FACTOR_BY_FAMILY', () => {
	it('priser el-sykkel som netto-MET-modellen i energy-expenditure gjør', () => {
		// Kryssjekk mot en uavhengig modell: el-sykkel 4,5 MET mot løpingens ~10,
		// begge minus hvilen man hadde brukt uansett → 3,5/9 ≈ 0,39.
		const nettoAndel = (4.5 - 1) / (10 - 1);
		expect(MET_FACTOR_BY_FAMILY.ebike).toBeCloseTo(nettoAndel, 1);
	});

	it('holder rekkefølgen løp > sykkel > el-sykkel', () => {
		expect(MET_FACTOR_BY_FAMILY.running).toBeGreaterThan(MET_FACTOR_BY_FAMILY.cycling);
		expect(MET_FACTOR_BY_FAMILY.cycling).toBeGreaterThan(MET_FACTOR_BY_FAMILY.ebike);
	});
});

describe('classifyEffortFamily', () => {
	it('skiller e-sykkel fra vanlig sykkel', () => {
		expect(classifyEffortFamily('e_bike', 'cycling')).toBe('ebike');
		expect(classifyEffortFamily('cycling', 'cycling')).toBe('cycling');
	});
});
