import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generatePkcePair, getAuthorizeUrl, TESLA_SCOPES } from './tesla';

function base64url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generatePkcePair', () => {
	it('lager en verifier på 43–128 tegn uten padding', () => {
		const { verifier } = generatePkcePair();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(verifier.length).toBeLessThanOrEqual(128);
		expect(verifier).not.toContain('=');
		expect(verifier).not.toContain('+');
		expect(verifier).not.toContain('/');
	});

	it('challenge er base64url(sha256(verifier))', () => {
		const { verifier, challenge } = generatePkcePair();
		const expected = base64url(createHash('sha256').update(verifier).digest());
		expect(challenge).toBe(expected);
	});

	it('gir nye verdier hver gang', () => {
		expect(generatePkcePair().verifier).not.toBe(generatePkcePair().verifier);
	});
});

describe('getAuthorizeUrl', () => {
	it('inneholder PKCE-parametre og read-only scopes', () => {
		const url = new URL(
			getAuthorizeUrl({
				redirectUri: 'https://example.com/cb',
				state: 'abc',
				codeChallenge: 'chal'
			})
		);
		expect(url.origin + url.pathname).toBe('https://auth.tesla.com/oauth2/v3/authorize');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('code_challenge')).toBe('chal');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('state')).toBe('abc');
		expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/cb');
		expect(url.searchParams.get('scope')).toBe(TESLA_SCOPES);
	});

	it('vehicle_location er med blant scopes (kreves for GPS)', () => {
		expect(TESLA_SCOPES).toContain('vehicle_location');
		expect(TESLA_SCOPES).toContain('vehicle_device_data');
		expect(TESLA_SCOPES).toContain('offline_access');
	});
});
