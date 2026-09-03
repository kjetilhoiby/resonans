import { describe, it, expect } from 'vitest';
import {
	shouldRefresh,
	resolveExpiresAt,
	EXPIRY_SKEW_SECONDS,
	FALLBACK_TTL_SECONDS
} from './sparebank1-token-rules';

const NOW = 1_757_000_000;

describe('shouldRefresh', () => {
	it('lar et ferskt token stå', () => {
		expect(shouldRefresh({ access_token: 'a', expires_at: NOW + 3600 }, NOW)).toBe(false);
	});

	it('fornyer et utløpt token', () => {
		expect(shouldRefresh({ access_token: 'a', expires_at: NOW - 1 }, NOW)).toBe(true);
	});

	it('fornyer innenfor slingringsmonnet', () => {
		// Ett sekund før grensa: skal fortsatt stå.
		expect(shouldRefresh({ access_token: 'a', expires_at: NOW + EXPIRY_SKEW_SECONDS + 1 }, NOW)).toBe(false);
		expect(shouldRefresh({ access_token: 'a', expires_at: NOW + EXPIRY_SKEW_SECONDS }, NOW)).toBe(true);
	});

	it('fornyer når expires_at MANGLER', () => {
		// Dette er den gamle feilen: gaten var `expires_at && …`, så et manglende
		// felt betydde «ikke forny» — og tokenet ble brukt til det døde.
		expect(shouldRefresh({ access_token: 'a' }, NOW)).toBe(true);
	});

	it('fornyer når expires_at ikke er et tall', () => {
		expect(shouldRefresh({ access_token: 'a', expires_at: NaN }, NOW)).toBe(true);
		expect(shouldRefresh({ access_token: 'a', expires_at: '123' as unknown as number }, NOW)).toBe(true);
	});

	it('fornyer når access_token mangler', () => {
		expect(shouldRefresh({ access_token: '', expires_at: NOW + 3600 }, NOW)).toBe(true);
	});
});

describe('resolveExpiresAt', () => {
	it('bruker expires_in når den finnes', () => {
		expect(resolveExpiresAt(3600, NOW)).toBe(NOW + 3600);
	});

	it('tåler expires_in som streng', () => {
		expect(resolveExpiresAt('3600', NOW)).toBe(NOW + 3600);
	});

	it('faller tilbake på et kort vindu når expires_in mangler', () => {
		// Aldri arv den gamle verdien: den lå i fortida, og et token som er
		// permanent «utløpt» refresher ved hvert eneste kall.
		expect(resolveExpiresAt(undefined, NOW)).toBe(NOW + FALLBACK_TTL_SECONDS);
		expect(resolveExpiresAt(null, NOW)).toBe(NOW + FALLBACK_TTL_SECONDS);
	});

	it('faller tilbake på ugyldige og ikke-positive verdier', () => {
		expect(resolveExpiresAt(0, NOW)).toBe(NOW + FALLBACK_TTL_SECONDS);
		expect(resolveExpiresAt(-100, NOW)).toBe(NOW + FALLBACK_TTL_SECONDS);
		expect(resolveExpiresAt('snart', NOW)).toBe(NOW + FALLBACK_TTL_SECONDS);
	});

	it('gir alltid et tidspunkt i FRAMTIDA', () => {
		for (const input of [undefined, null, 0, -1, 'tull', NaN, 3600]) {
			expect(resolveExpiresAt(input, NOW)).toBeGreaterThan(NOW);
		}
	});
});
