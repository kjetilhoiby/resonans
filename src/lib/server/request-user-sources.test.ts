import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	pickFallbackUserId,
	sanitizeUserId,
	sessionUserIdForAppCallback
} from './request-user-sources';

const UUID = '8e8b4aae-14f4-4e79-8fc3-ec5f37b0579d';

describe('pickFallbackUserId', () => {
	it('ignorerer ?userId= utenfor dev', () => {
		expect(pickFallbackUserId({ isDev: false, trustedHeader: null, query: UUID, cookie: null })).toBeNull();
	});

	it('ignorerer cookien utenfor dev', () => {
		expect(pickFallbackUserId({ isDev: false, trustedHeader: null, query: null, cookie: UUID })).toBeNull();
	});

	it('godtar en betrodd header også utenfor dev', () => {
		expect(pickFallbackUserId({ isDev: false, trustedHeader: UUID, query: 'annen-bruker', cookie: null })).toBe(UUID);
	});

	it('godtar query og cookie i dev, query først', () => {
		expect(pickFallbackUserId({ isDev: true, trustedHeader: null, query: 'fra-query', cookie: 'fra-cookie' })).toBe('fra-query');
		expect(pickFallbackUserId({ isDev: true, trustedHeader: null, query: null, cookie: 'fra-cookie' })).toBe('fra-cookie');
	});

	it('headeren vinner over query også i dev', () => {
		expect(pickFallbackUserId({ isDev: true, trustedHeader: UUID, query: 'fra-query', cookie: null })).toBe(UUID);
	});

	it('forkaster ugyldige id-er', () => {
		expect(pickFallbackUserId({ isDev: true, trustedHeader: 'a b', query: '../x', cookie: 'x' })).toBeNull();
	});
});

describe('sessionUserIdForAppCallback', () => {
	it('returnerer brukeren fra økta', () => {
		expect(sessionUserIdForAppCallback({ user: { id: UUID } })).toBe(UUID);
	});

	it('returnerer null uten økt — ingen fallback', () => {
		expect(sessionUserIdForAppCallback(null)).toBeNull();
		expect(sessionUserIdForAppCallback(undefined)).toBeNull();
		expect(sessionUserIdForAppCallback({ user: null })).toBeNull();
		expect(sessionUserIdForAppCallback({ user: { id: null } })).toBeNull();
	});

	it('forkaster en ugyldig id i økta', () => {
		expect(sessionUserIdForAppCallback({ user: { id: 'a b' } })).toBeNull();
	});
});

describe('sanitizeUserId', () => {
	it('trimmer og godtar uuid', () => {
		expect(sanitizeUserId(`  ${UUID} `)).toBe(UUID);
	});
	it('avviser tomt og for kort', () => {
		expect(sanitizeUserId('')).toBeNull();
		expect(sanitizeUserId('ab')).toBeNull();
	});
});

describe('/api/apps/callback', () => {
	// Stien er offentlig, og den utsteder legitimasjon. Den skal lese brukeren
	// fra økta og ingenting annet — `resolveRequestUserId` har dev-fallbacker, og
	// det var nettopp den som gjorde `?userId=` til en innlogging.
	const source = readFileSync(
		resolve(__dirname, '../../routes/api/apps/callback/+server.ts'),
		'utf8'
	);

	it('kaller ikke resolveRequestUserId', () => {
		expect(source).not.toMatch(/resolveRequestUserId\s*\(/);
	});

	it('leser brukeren gjennom sessionUserIdForAppCallback', () => {
		expect(source).toMatch(/sessionUserIdForAppCallback\s*\(/);
	});
});
