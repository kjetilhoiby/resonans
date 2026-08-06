import { describe, it, expect } from 'vitest';
import {
	buildAuthTokenRequest,
	parseAuthTokenResponse,
	normalizeModelName,
	liveWebSocketUrl,
	redactApiKeys,
	GeminiTokenShapeError,
	DEFAULT_LIVE_MODEL,
	DEFAULT_TTL_SECONDS,
	DEFAULT_NEW_SESSION_SECONDS,
	DEFAULT_USES,
	MAX_TTL_SECONDS,
	MIN_TTL_SECONDS,
	MAX_USES,
	LOCKED_FIELDS,
	selectLiveModels
} from './gemini-live-token';

const NOW = new Date('2026-08-06T10:00:00.000Z');

function secondsAfterNow(iso: string): number {
	return (Date.parse(iso) - NOW.getTime()) / 1000;
}

describe('normalizeModelName', () => {
	it('legger på models/-prefikset', () => {
		expect(normalizeModelName('gemini-3.1-flash-live-preview')).toBe(
			'models/gemini-3.1-flash-live-preview'
		);
	});

	it('lar et prefikset navn stå', () => {
		expect(normalizeModelName('models/noe-annet')).toBe('models/noe-annet');
	});

	it('faller tilbake på standardmodellen for tomt og manglende navn', () => {
		expect(normalizeModelName(null)).toBe(`models/${DEFAULT_LIVE_MODEL}`);
		expect(normalizeModelName('   ')).toBe(`models/${DEFAULT_LIVE_MODEL}`);
	});
});

describe('buildAuthTokenRequest — sikkerhetsgrensa', () => {
	it('låser verktøylista til tom', () => {
		/**
		 * Den viktigste testen i fila. Et token uten låste verktøy er en generell
		 * Gemini-nøkkel på vår kvote — med kodekjøring gjennom verktøy som verste
		 * utfall.
		 */
		const body = buildAuthTokenRequest({ now: NOW });
		expect(body.bidiGenerateContentSetup.tools).toEqual([]);
	});

	it('gjør tomheten bindende gjennom fieldMask', () => {
		/**
		 * `tools: []` alene holder ikke. Tom maske med en setup til stede betyr at
		 * klientens setup ignoreres HELT; en maske som lister feltene betyr at bare
		 * de overskrives. Vi vil det siste, og da må begge feltene stå i masken —
		 * uten `tools` der kan klienten legge til verktøy selv.
		 */
		const body = buildAuthTokenRequest({ now: NOW });
		const masked = body.fieldMask.split(',');
		expect(masked).toContain('model');
		expect(masked).toContain('tools');
		expect(body.fieldMask).toBe(LOCKED_FIELDS.join(','));
	});

	it('låser modellen', () => {
		const body = buildAuthTokenRequest({ now: NOW, model: 'gemini-x-live' });
		expect(body.bidiGenerateContentSetup.model).toBe('models/gemini-x-live');
	});

	it('låser ikke systeminstruksjonen — Ekko eier samtalen', () => {
		// Bevisst valg: Ekko skal kunne endre prompten uten en Resonans-deploy.
		// Låses den senere, skjer det ved å legge feltet i LOCKED_FIELDS.
		const body = buildAuthTokenRequest({ now: NOW });
		expect(body.fieldMask).not.toContain('systemInstruction');
		expect(body.bidiGenerateContentSetup).not.toHaveProperty('systemInstruction');
	});

	it('bruker wire-navnene, ikke SDK-navnene', () => {
		/**
		 * Dokumentasjonssida på ai.google.dev beskriver `liveConnectConstraints` med
		 * nøstet `model` og `config`. Det er Python-SDK-ens navn, og wire-formatet
		 * avviser det: «Unknown name "liveConnectConstraints" at 'auth_token'».
		 * Verifisert mot Googles discovery-dokument.
		 */
		const body = buildAuthTokenRequest({ now: NOW }) as unknown as Record<string, unknown>;
		expect(body).toHaveProperty('bidiGenerateContentSetup');
		expect(body).not.toHaveProperty('liveConnectConstraints');
	});
});

describe('buildAuthTokenRequest — levetider', () => {
	it('bruker standardverdiene når ingenting oppgis', () => {
		const body = buildAuthTokenRequest({ now: NOW });
		expect(secondsAfterNow(body.expireTime)).toBe(DEFAULT_TTL_SECONDS);
		expect(secondsAfterNow(body.newSessionExpireTime)).toBe(DEFAULT_NEW_SESSION_SECONDS);
		expect(body.uses).toBe(DEFAULT_USES);
	});

	it('gir rom for én kald omstart', () => {
		// Reetablering av en økt teller IKKE som en bruk hos Google, så
		// nettverksglipp underveis er gratis. Den andre bruken dekker det ene som
		// ikke er: en kald omstart der appen mistet resumption-handtaket.
		expect(buildAuthTokenRequest({ now: NOW }).uses).toBe(2);
	});

	it('tillater aldri ubegrenset bruk', () => {
		// `uses: 0` betyr ubegrenset hos Google. Det skal ikke kunne bes om.
		expect(buildAuthTokenRequest({ now: NOW, uses: 0 }).uses).toBeGreaterThan(0);
		expect(buildAuthTokenRequest({ now: NOW, uses: -5 }).uses).toBeGreaterThan(0);
	});

	it('klipper framfor å avvise verdier utenfor grensene', () => {
		const long = buildAuthTokenRequest({ now: NOW, ttlSeconds: 5 * 60 * 60, uses: 99 });
		expect(secondsAfterNow(long.expireTime)).toBe(MAX_TTL_SECONDS);
		expect(long.uses).toBe(MAX_USES);

		const short = buildAuthTokenRequest({ now: NOW, ttlSeconds: 5, uses: 0 });
		expect(secondsAfterNow(short.expireTime)).toBe(MIN_TTL_SECONDS);
		expect(short.uses).toBe(DEFAULT_USES);
	});

	it('lar ikke åpningsvinduet bli lengre enn økta', () => {
		// Et vindu for å åpne økta som varer lenger enn økta selv er selvmotsigende.
		const body = buildAuthTokenRequest({ now: NOW, ttlSeconds: 300, newSessionSeconds: 600 });
		expect(secondsAfterNow(body.newSessionExpireTime)).toBeLessThanOrEqual(
			secondsAfterNow(body.expireTime)
		);
	});

	it('tåler tull i tallfeltene', () => {
		const body = buildAuthTokenRequest({
			now: NOW,
			ttlSeconds: Number.NaN,
			newSessionSeconds: null,
			uses: Number.POSITIVE_INFINITY
		});
		expect(secondsAfterNow(body.expireTime)).toBe(DEFAULT_TTL_SECONDS);
		expect(body.uses).toBe(DEFAULT_USES);
	});

	it('skriver tidene som ISO-tidsstempler', () => {
		const body = buildAuthTokenRequest({ now: NOW });
		expect(body.expireTime).toBe('2026-08-06T10:30:00.000Z');
		expect(body.newSessionExpireTime).toBe('2026-08-06T10:02:00.000Z');
	});
});

describe('parseAuthTokenResponse', () => {
	it('leser credentialen fra «name»', () => {
		// Feltet heter `name`, ikke `token` — et navn som inviterer til å lese feil
		// felt og sende et tomt token videre til appen.
		const parsed = parseAuthTokenResponse({
			name: 'auth_tokens/abc123',
			expireTime: '2026-08-06T10:30:00Z',
			newSessionExpireTime: '2026-08-06T10:02:00Z'
		});
		expect(parsed.token).toBe('auth_tokens/abc123');
		expect(parsed.expiresAt).toBe('2026-08-06T10:30:00Z');
		expect(parsed.newSessionExpiresAt).toBe('2026-08-06T10:02:00Z');
	});

	it('kaster med nøklene som faktisk kom når «name» mangler', () => {
		// En endret API-kontrakt skal være støyende, ikke stille.
		expect(() => parseAuthTokenResponse({ token: 'feil-felt' })).toThrow(GeminiTokenShapeError);
		expect(() => parseAuthTokenResponse({ token: 'feil-felt' })).toThrow(/token/);
	});

	it('kaster på noe som ikke er et objekt', () => {
		expect(() => parseAuthTokenResponse(null)).toThrow(GeminiTokenShapeError);
		expect(() => parseAuthTokenResponse('auth_tokens/abc')).toThrow(GeminiTokenShapeError);
	});

	it('godtar et svar uten utløpstider', () => {
		const parsed = parseAuthTokenResponse({ name: 'auth_tokens/abc' });
		expect(parsed.token).toBe('auth_tokens/abc');
		expect(parsed.expiresAt).toBeNull();
	});
});

describe('liveWebSocketUrl', () => {
	it('bruker den CONSTRAINED metoden og access_token', () => {
		/**
		 * Et constrained token virker ikke mot `BidiGenerateContent?key=`. Feilen
		 * gir en 4xx uten forklaring, og det er grunnen til at endepunktet
		 * returnerer hele URL-en framfor å la appen sette den sammen.
		 */
		const url = liveWebSocketUrl('auth_tokens/abc123');
		expect(url).toContain('BidiGenerateContentConstrained');
		expect(url).not.toContain('?key=');
		expect(url).toContain('access_token=auth_tokens%2Fabc123');
	});
});

describe('redactApiKeys', () => {
	it('fjerner Googles nøkkelformat', () => {
		const dirty = 'API key not valid: AIzaSyC-abcdefghijklmnopqrstuvwxyz123';
		expect(redactApiKeys(dirty)).not.toContain('AIzaSy');
		expect(redactApiKeys(dirty)).toContain('[nøkkel fjernet]');
	});

	it('fjerner den faktiske nøkkelen selv når den ikke matcher mønsteret', () => {
		expect(redactApiKeys('feil med hemmelig-nokkel-1234', 'hemmelig-nokkel-1234')).toBe(
			'feil med [nøkkel fjernet]'
		);
	});

	it('lar en ufarlig melding stå', () => {
		expect(redactApiKeys('models/gemini-x finnes ikke')).toBe('models/gemini-x finnes ikke');
	});
});

describe('selectLiveModels', () => {
	function katalog(models: unknown) {
		return selectLiveModels({ models }, 'gemini-3.1-flash-live-preview');
	}

	it('filtrerer på generasjonsmetoden, ikke på navnet', () => {
		/**
		 * Et navn som inneholder «live» er en gjetning; metodelista er modellens egen
		 * erklæring. Her har den ene modellen «live» i navnet uten å støtte metoden,
		 * og den andre motsatt.
		 */
		const models = katalog([
			{ name: 'models/gemini-live-lookalike', supportedGenerationMethods: ['generateContent'] },
			{ name: 'models/gemini-4-audio', supportedGenerationMethods: ['bidiGenerateContent'] }
		]);
		expect(models.map((m) => m.id)).toEqual(['gemini-4-audio']);
	});

	it('stripper models/-prefikset, klart til GEMINI_LIVE_MODEL', () => {
		const models = katalog([
			{ name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] }
		]);
		expect(models[0].id).toBe('gemini-3.1-flash-live-preview');
		expect(models[0].isDefault).toBe(true);
	});

	it('markerer ingen som default når defaulten er utdatert', () => {
		// Tilstanden som stille ødelegger alt: minting virker helt til noen kobler til.
		const models = katalog([
			{ name: 'models/gemini-9-live', supportedGenerationMethods: ['bidiGenerateContent'] }
		]);
		expect(models.some((m) => m.isDefault)).toBe(false);
	});

	it('sorterer nyeste først', () => {
		const models = katalog([
			{ name: 'models/gemini-2.5-live', supportedGenerationMethods: ['bidiGenerateContent'] },
			{ name: 'models/gemini-4.0-live', supportedGenerationMethods: ['bidiGenerateContent'] },
			{ name: 'models/gemini-3.1-live', supportedGenerationMethods: ['bidiGenerateContent'] }
		]);
		expect(models.map((m) => m.id)).toEqual(['gemini-4.0-live', 'gemini-3.1-live', 'gemini-2.5-live']);
	});

	it('tåler et svar uten models-liste og rader uten navn', () => {
		expect(selectLiveModels(null, 'x')).toEqual([]);
		expect(selectLiveModels({ models: 'ikke en liste' }, 'x')).toEqual([]);
		expect(katalog([null, {}, { supportedGenerationMethods: ['bidiGenerateContent'] }])).toEqual([]);
	});
});

describe('utløpstider som Google ikke returnerer', () => {
	it('dokumenterer at feltene er input-only', () => {
		/**
		 * Verifisert mot prod: et ekte token kom tilbake uten `expireTime` og
		 * `newSessionExpireTime`, fordi begge er «Input only» i Googles skjema.
		 * Parseren gir null, og `mintLiveToken` fyller inn det vi ba om — uten det
		 * får appen ingen frister å planlegge etter.
		 */
		const parsed = parseAuthTokenResponse({ name: 'auth_tokens/abc' });
		expect(parsed.expiresAt).toBeNull();
		expect(parsed.newSessionExpiresAt).toBeNull();

		// Verdiene finnes i kroppen vi sendte, og det er kilden fallbacken bruker.
		const body = buildAuthTokenRequest({ now: NOW });
		expect(body.expireTime).toBeTruthy();
		expect(body.newSessionExpireTime).toBeTruthy();
	});
});
