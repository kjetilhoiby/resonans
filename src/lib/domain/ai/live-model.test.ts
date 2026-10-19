import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_MODEL } from './gemini-live-token';
import { chooseLiveModel, parseLiveAliasPayload, type LiveAliasPayload } from './live-model';

const labSvar = {
	alias: 'live',
	modell: { id: 'google/gemini-3.1-flash-live-preview', leverandor: 'google', model: 'gemini-3.1-flash-live-preview', utloper: '2026-11-17' },
	reserve: { id: 'google/gemini-3.8-live', leverandor: 'google', model: 'gemini-3.8-live', utloper: null }
};

const katalog = new Set(['gemini-3.1-flash-live-preview', 'gemini-3.8-live']);

describe('parseLiveAliasPayload', () => {
	it('leser modell, reserve og stengedato', () => {
		expect(parseLiveAliasPayload(labSvar)).toEqual({
			model: { model: 'gemini-3.1-flash-live-preview', provider: 'google', expires: '2026-11-17' },
			reserve: { model: 'gemini-3.8-live', provider: 'google', expires: null }
		});
	});

	it('godtar et svar uten reserve', () => {
		expect(parseLiveAliasPayload({ ...labSvar, reserve: null })?.reserve).toBeNull();
	});

	it('avviser et svar for et annet alias, eller uten modell', () => {
		expect(parseLiveAliasPayload({ ...labSvar, alias: 'json_cheap' })).toBeNull();
		expect(parseLiveAliasPayload({ alias: 'live', modell: null })).toBeNull();
		expect(parseLiveAliasPayload('tull')).toBeNull();
	});
});

describe('chooseLiveModel', () => {
	const payload = parseLiveAliasPayload(labSvar) as LiveAliasPayload;

	it('bruker aliasets modell når den er åpen og finnes i katalogen', () => {
		expect(chooseLiveModel({ payload, catalogue: katalog, today: '2026-10-19' })).toEqual({
			model: 'gemini-3.1-flash-live-preview',
			source: 'stemmegaffel',
			reasons: []
		});
	});

	it('tar reserven på stengedagen, ikke dagen etter', () => {
		const valg = chooseLiveModel({ payload, catalogue: katalog, today: '2026-11-17' });
		expect(valg.model).toBe('gemini-3.8-live');
		expect(valg.source).toBe('reserve');
		expect(valg.reasons).toEqual(['gemini-3.1-flash-live-preview stengte 2026-11-17']);
	});

	it('tar reserven når modellen er borte fra Googles katalog, selv uten stengedato', () => {
		const valg = chooseLiveModel({ payload, catalogue: new Set(['gemini-3.8-live']), today: '2026-10-19' });
		expect(valg.source).toBe('reserve');
		expect(valg.reasons[0]).toMatch(/finnes ikke i Googles katalog/);
	});

	it('lar en ukjent katalog være: da hindrer den ingenting', () => {
		expect(chooseLiveModel({ payload, catalogue: null, today: '2026-10-19' }).source).toBe('stemmegaffel');
	});

	it('faller til standarden når både modell og reserve er ubrukelige, og sier hvorfor', () => {
		const valg = chooseLiveModel({ payload, catalogue: new Set(), today: '2026-11-17' });
		expect(valg.model).toBe(DEFAULT_LIVE_MODEL);
		expect(valg.source).toBe('default');
		expect(valg.reasons).toHaveLength(2);
	});

	it('faller til standarden uten svar fra laben, med grunnen', () => {
		expect(chooseLiveModel({ payload: null, missingReason: 'STEMMEGAFFEL_URL er ikke satt', catalogue: katalog, today: '2026-10-19' })).toEqual({
			model: DEFAULT_LIVE_MODEL,
			source: 'default',
			reasons: ['STEMMEGAFFEL_URL er ikke satt']
		});
	});

	it('sier fra når aliaset ikke har noen reserve å falle til', () => {
		const utenReserve = { ...payload, reserve: null };
		expect(chooseLiveModel({ payload: utenReserve, catalogue: katalog, today: '2026-11-17' }).reasons).toContain('aliaset har ingen reserve');
	});

	it('bruker aldri en modell fra en annen leverandør', () => {
		const feil = { ...payload, model: { model: 'gpt-realtime', provider: 'openai', expires: null } };
		expect(chooseLiveModel({ payload: feil, catalogue: null, today: '2026-10-19' }).source).toBe('reserve');
	});
});
