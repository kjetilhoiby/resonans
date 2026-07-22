import { describe, it, expect } from 'vitest';
import {
	normalizeDomains,
	classifyResearchTopic,
	resolveResearchScope,
	expandResearchQueries,
	TRAVEL_DOMAINS,
	NEWS_DOMAINS,
	LOW_QUALITY_DOMAINS
} from './research-domains';

describe('normalizeDomains', () => {
	it('strippers protokoll, www og sti', () => {
		expect(normalizeDomains(['https://www.visitnorway.no/oslo'])).toEqual(['visitnorway.no']);
	});

	it('trimmer, lowercaser og fjerner duplikater', () => {
		expect(normalizeDomains([' NRK.no ', 'nrk.no', 'vg.no'])).toEqual(['nrk.no', 'vg.no']);
	});

	it('takler tomt/ugyldig input', () => {
		expect(normalizeDomains(undefined)).toEqual([]);
		expect(normalizeDomains(['', '   '])).toEqual([]);
	});
});

describe('classifyResearchTopic', () => {
	it('kjenner igjen reise/steds-spørsmål', () => {
		expect(classifyResearchTopic('Hva kan jeg gjøre i Hornbæk?')).toBe('travel');
		expect(classifyResearchTopic('beste restauranter i Lisboa')).toBe('travel');
		expect(classifyResearchTopic('things to do in Berlin')).toBe('travel');
	});

	it('kjenner igjen ferske/nyhets-spørsmål', () => {
		expect(classifyResearchTopic('siste nytt om renten')).toBe('news');
		expect(classifyResearchTopic('hva skjer i valget i dag')).toBe('news');
	});

	it('faller tilbake til general', () => {
		expect(classifyResearchTopic('forklar fotosyntese')).toBe('general');
	});
});

describe('resolveResearchScope', () => {
	it('reise → reise-domener, general topic, støyfilter', () => {
		const scope = resolveResearchScope('Hva kan jeg gjøre i Hornbæk?');
		expect(scope.topic).toBe('travel');
		expect(scope.tavilyTopic).toBe('general');
		expect(scope.includeDomains).toEqual(expect.arrayContaining(TRAVEL_DOMAINS));
		expect(scope.excludeDomains).toEqual(expect.arrayContaining(['pinterest.com']));
	});

	it('nyheter → news topic med tidsvindu og nyhetsdomener', () => {
		const scope = resolveResearchScope('siste nytt om børsen i dag');
		expect(scope.topic).toBe('news');
		expect(scope.tavilyTopic).toBe('news');
		expect(scope.days).toBeGreaterThan(0);
		expect(scope.includeDomains).toEqual(expect.arrayContaining(NEWS_DOMAINS));
	});

	it('general → ingen include, kun støyfilter', () => {
		const scope = resolveResearchScope('forklar fotosyntese');
		expect(scope.includeDomains).toBeUndefined();
		expect(scope.excludeDomains).toEqual(LOW_QUALITY_DOMAINS);
	});

	it('tema-include flettes inn og fjernes fra ekskludering', () => {
		const scope = resolveResearchScope('forklar fotosyntese', {
			include: ['forskning.no'],
			exclude: ['demagog.no']
		});
		expect(scope.includeDomains).toContain('forskning.no');
		expect(scope.excludeDomains).toContain('demagog.no');
	});

	it('et domene som er både include og exclude ender kun i include', () => {
		const scope = resolveResearchScope('nøytralt spørsmål', {
			include: ['pinterest.com'] // brukeren vil eksplisitt ha denne
		});
		expect(scope.includeDomains).toContain('pinterest.com');
		expect(scope.excludeDomains).not.toContain('pinterest.com');
	});
});

describe('expandResearchQueries', () => {
	it('reise gir tre vinkler', () => {
		const qs = expandResearchQueries('Hornbæk', 'travel');
		expect(qs).toHaveLength(3);
		expect(qs[0]).toBe('Hornbæk');
		expect(qs.some((q) => /severdigheter/.test(q))).toBe(true);
		expect(qs.some((q) => /restauranter/.test(q))).toBe(true);
	});

	it('general gir original + bakgrunn', () => {
		expect(expandResearchQueries('fotosyntese', 'general')).toEqual([
			'fotosyntese',
			'fotosyntese bakgrunn og detaljer'
		]);
	});

	it('tomt spørsmål gir tom liste', () => {
		expect(expandResearchQueries('   ', 'travel')).toEqual([]);
	});
});
