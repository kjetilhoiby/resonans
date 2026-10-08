import { describe, it, expect } from 'vitest';
import {
	buildCoverage,
	describeCoverage,
	missingToday,
	nextUnlock,
	type RegistrationDomain
} from './registration-coverage';
import { MIN_DAYS_FOR_VERDICT, MIN_LOGGED_COVERAGE } from './nutrition/weight-reality-check';
import { MIN_WEEK_WEIGH_INS } from './digest-nugget-rules';

const TODAY = '2026-10-08';

function days(...offsets: number[]): Set<string> {
	return new Set(
		offsets.map((o) => {
			const d = new Date(`${TODAY}T12:00:00Z`);
			d.setUTCDate(d.getUTCDate() - o);
			return d.toISOString().slice(0, 10);
		})
	);
}

function input(partial: Partial<Record<RegistrationDomain, Set<string>>>): Record<RegistrationDomain, Set<string>> {
	return { mat: new Set(), vekt: new Set(), oppgaver: new Set(), egenfrekvens: new Set(), lesing: new Set(), ...partial };
}

describe('buildCoverage', () => {
	it('teller sju og fjorten dager, med i dag sist', () => {
		const [mat] = buildCoverage(input({ mat: days(0, 1, 2, 10, 13, 20) }), TODAY);
		expect(mat.last7).toBe(3);
		expect(mat.last14).toBe(5);
		expect(mat.today).toBe(true);
		expect(mat.week).toEqual([false, false, false, false, true, true, true]);
	});
});

describe('describeCoverage', () => {
	it('sier alle fem i fast rekkefølge, uten skår', () => {
		const coverage = buildCoverage(input({ mat: days(0, 1, 2), vekt: days(0, 1, 2, 3, 4, 5) }), TODAY);
		expect(describeCoverage(coverage)).toBe(
			'Registrert siste sju dager: mat 3, vekt 6, oppgaver 0, egenfrekvens 0 og lesing 0 dager.'
		);
	});
});

describe('missingToday', () => {
	it('lister det som ikke er registrert i dag', () => {
		expect(missingToday(buildCoverage(input({ vekt: days(0) }), TODAY))).toEqual(['mat', 'oppgaver', 'egenfrekvens', 'lesing']);
	});
});

describe('nextUnlock', () => {
	const needed = Math.ceil(MIN_LOGGED_COVERAGE * MIN_DAYS_FOR_VERDICT);

	it('sier hva matloggen låser opp, med motorens egen terskel', () => {
		const text = nextUnlock(buildCoverage(input({ mat: days(0, 1, 2) }), TODAY));
		expect(text).toBe(
			`Mat er logget 3 av de siste ${MIN_DAYS_FOR_VERDICT} dagene. Med ${needed} kan jeg si om energiregnskapet stemmer med vekta.`
		);
	});

	it('går videre til vekta når maten er dekket', () => {
		const allMat = days(...Array.from({ length: needed }, (_, i) => i));
		const text = nextUnlock(buildCoverage(input({ mat: allMat, vekt: days(0) }), TODAY));
		expect(text).toContain(`Med ${MIN_WEEK_WEIGH_INS} kan jeg si hva uka ble på vekta.`);
	});

	it('tier når ingen terskel står igjen', () => {
		const all = days(...Array.from({ length: 14 }, (_, i) => i));
		expect(nextUnlock(buildCoverage(input({ mat: all, vekt: all }), TODAY))).toBeNull();
	});
});
