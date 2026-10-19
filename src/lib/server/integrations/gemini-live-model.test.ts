import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetLabAliasCache } from '$lib/server/ai/lab-alias';
import { DEFAULT_LIVE_MODEL } from '$lib/domain/ai/gemini-live-token';

/**
 * Hele veien fra aliaset i laben og Googles katalog til modellen i tokenet, med
 * falske svar fra begge. Reglene er testet rent i `live-model.test.ts`; her
 * prøves det som binder dem sammen: at miljøvariablene IKKE leses lenger, og at
 * en modell som er borte fra katalogen gir reserven i selve tokenet.
 */

const labSvar = {
	alias: 'live',
	modell: { leverandor: 'google', model: 'gemini-3.1-flash-live-preview', utloper: '2099-01-01' },
	reserve: { leverandor: 'google', model: 'gemini-3.8-live', utloper: null }
};

function googleKatalog(navn: string[]) {
	return { models: navn.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['bidiGenerateContent'] })) };
}

let katalog: string[];
let mintet: unknown[];

beforeEach(() => {
	vi.resetModules();
	_resetLabAliasCache();
	process.env.STEMMEGAFFEL_URL = 'https://lab.test';
	process.env.GEMINI_API_KEY = 'AIzaFalskNokkel1234567890';
	process.env.GEMINI_LIVE_MODEL = 'gemini-fra-coolify';
	katalog = ['gemini-3.1-flash-live-preview', 'gemini-3.8-live'];
	mintet = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (url.startsWith('https://lab.test/api/v1/aliaser/live')) return new Response(JSON.stringify(labSvar));
		if (url.includes('/v1beta/models')) return new Response(JSON.stringify(googleKatalog(katalog)));
		if (url.includes('/v1beta/auth_tokens')) {
			mintet.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ name: 'auth_tokens/falsk' }));
		}
		throw new Error(`uventet kall: ${url}`);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.STEMMEGAFFEL_URL;
	delete process.env.GEMINI_LIVE_MODEL;
});

const modellITokenet = () => (mintet[0] as { bidiGenerateContentSetup: { model: string } }).bidiGenerateContentSetup.model;

describe('Live-modellen fra aliaset', () => {
	it('låser tokenet til aliasets modell, og leser ikke GEMINI_LIVE_MODEL', async () => {
		const { mintLiveToken } = await import('./gemini-live');
		await mintLiveToken({ profile: 'coach' });
		expect(modellITokenet()).toBe('models/gemini-3.1-flash-live-preview');
	});

	it('tar reserven når modellen er borte fra Googles katalog', async () => {
		katalog = ['gemini-3.8-live'];
		const { mintLiveToken } = await import('./gemini-live');
		await mintLiveToken({ profile: 'assistant' });
		expect(modellITokenet()).toBe('models/gemini-3.8-live');
	});

	it('et eksplisitt valg fra kallstedet vinner over aliaset', async () => {
		const { mintLiveToken } = await import('./gemini-live');
		await mintLiveToken({ model: 'gemini-3.8-live' });
		expect(modellITokenet()).toBe('models/gemini-3.8-live');
	});

	it('bruker standarden i koden uten laben', async () => {
		delete process.env.STEMMEGAFFEL_URL;
		const { mintLiveToken } = await import('./gemini-live');
		await mintLiveToken({});
		expect(modellITokenet()).toBe(`models/${DEFAULT_LIVE_MODEL}`);
	});

	it('modellista sier hvor standarden kom fra', async () => {
		katalog = ['gemini-3.8-live'];
		const { listLiveModels } = await import('./gemini-live');
		const svar = await listLiveModels();
		expect(svar.effectiveDefault).toBe('gemini-3.8-live');
		expect(svar.source).toBe('reserve');
		expect(svar.defaultIsStale).toBe(false);
		expect(svar.models.find((m) => m.isDefault)?.id).toBe('gemini-3.8-live');
	});
});
