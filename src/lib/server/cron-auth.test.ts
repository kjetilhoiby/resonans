import { describe, it, expect } from 'vitest';
import { cronAuthProblem } from './cron-auth';

function headers(entries: Record<string, string>) {
	return {
		get(name: string) {
			return entries[name.toLowerCase()] ?? null;
		}
	};
}

const HEMMELIGHET = 'en-hemmelighet';

describe('cronAuthProblem', () => {
	it('slipper gjennom riktig Bearer-token', () => {
		expect(
			cronAuthProblem(headers({ authorization: `Bearer ${HEMMELIGHET}` }), {
				isDev: false,
				expectedSecret: HEMMELIGHET
			})
		).toBeNull();
	});

	it('avviser feil hemmelighet', () => {
		expect(
			cronAuthProblem(headers({ authorization: 'Bearer noe-annet' }), {
				isDev: false,
				expectedSecret: HEMMELIGHET
			})
		).toBe('Authorization stemmer ikke.');
	});

	it('avviser manglende header', () => {
		expect(
			cronAuthProblem(headers({}), { isDev: false, expectedSecret: HEMMELIGHET })
		).toBe('mangler Authorization-header.');
	});

	it('avviser hemmeligheten uten Bearer-prefiks', () => {
		expect(
			cronAuthProblem(headers({ authorization: HEMMELIGHET }), {
				isDev: false,
				expectedSecret: HEMMELIGHET
			})
		).toBe('Authorization stemmer ikke.');
	});

	// Kjernen i rettelsen: den gamle sjekken var `env.CRON_SECRET && …`, altså
	// åpen dør uten hemmelighet. Seks endepunkter gjorde det samme med
	// `env.VERCEL_ENV &&`, som utenfor Vercel er åpen dør uansett.
	it('avviser ALT når hemmeligheten mangler deployet', () => {
		expect(
			cronAuthProblem(headers({ authorization: 'Bearer hva-som-helst' }), {
				isDev: false,
				expectedSecret: undefined
			})
		).toMatch(/CRON_SECRET er ikke satt/);
	});

	it('avviser også uten header når hemmeligheten mangler deployet', () => {
		expect(cronAuthProblem(headers({}), { isDev: false, expectedSecret: undefined })).toMatch(
			/CRON_SECRET er ikke satt/
		);
	});

	it('tom streng er ikke en hemmelighet', () => {
		expect(cronAuthProblem(headers({}), { isDev: false, expectedSecret: '' })).toMatch(
			/CRON_SECRET er ikke satt/
		);
	});

	it('lokalt uten hemmelighet slipper gjennom', () => {
		expect(cronAuthProblem(headers({}), { isDev: true, expectedSecret: undefined })).toBeNull();
	});

	it('lokalt MED hemmelighet kreves den likevel', () => {
		expect(cronAuthProblem(headers({}), { isDev: true, expectedSecret: HEMMELIGHET })).toBe(
			'mangler Authorization-header.'
		);
	});

	it('et prefiks av riktig hemmelighet avvises', () => {
		expect(
			cronAuthProblem(headers({ authorization: `Bearer ${HEMMELIGHET.slice(0, 5)}` }), {
				isDev: false,
				expectedSecret: HEMMELIGHET
			})
		).toBe('Authorization stemmer ikke.');
	});
});
