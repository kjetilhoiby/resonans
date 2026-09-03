import { describe, it, expect } from 'vitest';
import { classifyCronResult } from './cron-result';

describe('classifyCronResult', () => {
	it('regner en ren kjøring som vellykket', () => {
		expect(classifyCronResult({ success: true, users: 3, succeeded: 3, failed: 0 })).toBe('success');
	});

	it('fanger feil som ligger i failed-telleren, ikke på toppnivå', () => {
		// Formen fra /api/cron/sparebank1-sync: endepunktet fanger feilen per
		// bruker, så det finnes ingen `error`-nøkkel å se etter. Dette er
		// nøyaktig kjøringen som ble bokført som «success» i tre døgn.
		const result = {
			success: true,
			users: 1,
			succeeded: 0,
			failed: 1,
			results: [{ userId: 'u1', success: false, error: 'refresh feilet' }]
		};
		expect(classifyCronResult(result)).toBe('partial');
	});

	it('fanger delvis feil når bare noen brukere feilet', () => {
		expect(classifyCronResult({ success: true, users: 5, succeeded: 4, failed: 1 })).toBe('partial');
	});

	it('hører på success: false', () => {
		// rescuetime-sync og economics-dedup setter `success: failed === 0`.
		expect(classifyCronResult({ success: false, users: 2, failed: 2 })).toBe('partial');
	});

	it('beholder den gamle regelen om error på toppnivå', () => {
		expect(classifyCronResult({ success: true, error: 'noe gikk galt' })).toBe('partial');
	});

	it('er et supersett av den gamle regelen: error-nøkkelen teller uansett verdi', () => {
		// Den gamle regelen var `'error' in result`, uten å se på verdien. Å
		// stramme inn her ville fått noe til å SLUTTE å varsle, og det er ikke
		// det denne endringen handler om.
		expect(classifyCronResult({ success: true, error: null })).toBe('partial');
	});

	it('tåler resultater som ikke er objekter', () => {
		expect(classifyCronResult(undefined)).toBe('success');
		expect(classifyCronResult(null)).toBe('success');
		expect(classifyCronResult('ferdig')).toBe('success');
		expect(classifyCronResult(42)).toBe('success');
	});

	it('lar en failed på null være vellykket', () => {
		expect(classifyCronResult({ success: true, failed: 0 })).toBe('success');
	});

	it('ignorerer en failed som ikke er et tall', () => {
		// `failed: 'nei'` er ikke en telling, og skal ikke gjettes som en feil.
		expect(classifyCronResult({ success: true, failed: 'nei' })).toBe('success');
	});
});
