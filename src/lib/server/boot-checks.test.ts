import { describe, it, expect } from 'vitest';
import { assertBootReady, bootProblems } from './boot-checks';

const OK = { isDev: false, authConfigured: true, cronSecret: 'hemmelig' };

describe('bootProblems', () => {
	it('er tom når alt er på plass', () => {
		expect(bootProblems(OK)).toEqual([]);
	});

	it('sier fra når Google-auth mangler', () => {
		const problems = bootProblems({ ...OK, authConfigured: false });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/hele appen ville stått åpen/);
	});

	it('sier fra når CRON_SECRET mangler', () => {
		const problems = bootProblems({ ...OK, cronSecret: undefined });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/CRON_SECRET/);
	});

	it('tom streng teller som manglende', () => {
		expect(bootProblems({ ...OK, cronSecret: '' })).toHaveLength(1);
	});

	it('rapporterer begge på én gang, ikke bare den første', () => {
		expect(bootProblems({ isDev: false, authConfigured: false, cronSecret: undefined })).toHaveLength(2);
	});

	// Lokalt skal en fersk klone kunne kjøres uten OAuth-oppsett og uten
	// cron-hemmelighet — det er hele grunnen til at grenene finnes.
	it('krever ingenting lokalt', () => {
		expect(bootProblems({ isDev: true, authConfigured: false, cronSecret: undefined })).toEqual([]);
	});
});

describe('assertBootReady', () => {
	it('kaster ikke når alt er på plass', () => {
		expect(() => assertBootReady(OK)).not.toThrow();
	});

	it('kaster med alle problemene nummerert i meldingen', () => {
		expect(() =>
			assertBootReady({ isDev: false, authConfigured: false, cronSecret: undefined })
		).toThrow(/2 manglende konfigurasjon[\s\S]*1\.[\s\S]*2\./);
	});
});
