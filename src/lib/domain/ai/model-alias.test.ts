import { describe, expect, it } from 'vitest';
import { applyAlias, parseAliasPayload, resolveAlias, shouldFallBackFromAlias } from './model-alias';

// Formen svaret har på /api/v1/aliaser/json_cheap 9. oktober 2026, forkortet.
const SVAR = {
	alias: 'json_cheap',
	versjon: 1,
	modell: {
		id: 'openai/gpt-4o-mini',
		leverandor: 'openai',
		model: 'gpt-4o-mini',
		rute: 'openai',
		snapshot: 'gpt-4o-mini-2024-07-18',
		params: { max_completion_tokens: 2000, temperature: 0, response_format: { type: 'json_object' } }
	},
	reserve: null
};

const KALL = {
	messages: [{ role: 'user', content: 'hei' }],
	temperature: 0.2,
	max_tokens: 400,
	response_format: { type: 'json_object' }
};

describe('parseAliasPayload', () => {
	it('leser svaret fra laben', () => {
		expect(parseAliasPayload(SVAR)).toEqual({
			alias: 'json_cheap',
			provider: 'openai',
			route: 'openai',
			model: 'gpt-4o-mini',
			snapshot: 'gpt-4o-mini-2024-07-18',
			params: SVAR.modell.params
		});
	});

	it('avviser et svar uten modell', () => {
		expect(parseAliasPayload({ alias: 'json_cheap', modell: null })).toBeNull();
		expect(parseAliasPayload({ feil: 'Ukjent alias' })).toBeNull();
		expect(parseAliasPayload({ alias: 'json_cheap', modell: { leverandor: 'openai', model: '  ' } })).toBeNull();
	});
});

describe('resolveAlias', () => {
	it('bruker standarden uten laben, og sier hvorfor', () => {
		const r = resolveAlias('json_cheap', null);
		expect(r).toMatchObject({ model: 'gpt-4o-mini', source: 'default', params: {} });
		expect(r.reason).toBeTruthy();
	});

	it('godtar en OpenAI-modell gått direkte', () => {
		expect(resolveAlias('json_cheap', parseAliasPayload(SVAR))).toMatchObject({ model: 'gpt-4o-mini', source: 'stemmegaffel' });
	});

	it('faller tilbake når aliaset peker på en annen leverandør', () => {
		const google = parseAliasPayload({ ...SVAR, modell: { ...SVAR.modell, leverandor: 'google', rute: 'google', model: 'gemini-3.8-flash' } });
		const r = resolveAlias('json_cheap', google);
		expect(r.source).toBe('default');
		expect(r.model).toBe('gpt-4o-mini');
		expect(r.reason).toContain('google');
	});

	it('faller tilbake når OpenAI-modellen ble målt gjennom OpenRouter', () => {
		const viaRouter = parseAliasPayload({ ...SVAR, modell: { ...SVAR.modell, rute: 'openrouter' } });
		expect(resolveAlias('json_cheap', viaRouter).source).toBe('default');
	});

	it('faller tilbake når laben svarer for et annet alias', () => {
		expect(resolveAlias('json_cheap', parseAliasPayload({ ...SVAR, alias: 'vision' })).source).toBe('default');
	});
});

describe('applyAlias', () => {
	it('lar kallet være som før med standarden', () => {
		const ut = applyAlias(KALL, resolveAlias('json_cheap', null));
		expect(ut).toEqual({ ...KALL, model: 'gpt-4o-mini' });
	});

	it('bytter navnet på tokentaket, men beholder kallstedets verdi', () => {
		const ut = applyAlias(KALL, resolveAlias('json_cheap', parseAliasPayload(SVAR)));
		expect(ut.max_completion_tokens).toBe(400);
		expect('max_tokens' in ut).toBe(false);
	});

	it('beholder kallstedets temperatur og svarformat når modellen tar dem', () => {
		const ut = applyAlias(KALL, resolveAlias('json_cheap', parseAliasPayload(SVAR)));
		expect(ut.temperature).toBe(0.2);
		expect(ut.response_format).toEqual({ type: 'json_object' });
		expect(ut.messages).toBe(KALL.messages);
	});

	it('dropper temperaturen når modellen ikke er målt å ta den', () => {
		const tenker = parseAliasPayload({
			...SVAR,
			modell: { ...SVAR.modell, model: 'gpt-5.4-mini', params: { max_completion_tokens: 4000, reasoning_effort: 'low' } }
		});
		const ut = applyAlias(KALL, resolveAlias('json_cheap', tenker));
		expect(ut).toMatchObject({ model: 'gpt-5.4-mini', max_completion_tokens: 400, reasoning_effort: 'low' });
		expect('temperature' in ut).toBe(false);
	});

	it('lar kallstedets eget tenkenivå stå', () => {
		const tenker = parseAliasPayload({ ...SVAR, modell: { ...SVAR.modell, params: { reasoning_effort: 'low' } } });
		const ut = applyAlias({ ...KALL, reasoning_effort: 'minimal' }, resolveAlias('json_cheap', tenker));
		expect(ut.reasoning_effort).toBe('minimal');
	});

	it('bruker labens tak når kallstedet ikke har satt noe', () => {
		const { max_tokens: _, ...utenTak } = KALL;
		const ut = applyAlias(utenTak, resolveAlias('json_cheap', parseAliasPayload(SVAR)));
		expect(ut.max_completion_tokens).toBe(2000);
	});
});

describe('shouldFallBackFromAlias', () => {
	it('prøver standarden når OpenAI avviste forespørselen', () => {
		expect(shouldFallBackFromAlias('stemmegaffel', 400)).toBe(true);
		expect(shouldFallBackFromAlias('stemmegaffel', 404)).toBe(true);
	});

	it('prøver ikke på nytt ved kø, nettverk eller når standarden alt ble brukt', () => {
		expect(shouldFallBackFromAlias('stemmegaffel', 429)).toBe(false);
		expect(shouldFallBackFromAlias('stemmegaffel', undefined)).toBe(false);
		expect(shouldFallBackFromAlias('default', 400)).toBe(false);
	});
});
