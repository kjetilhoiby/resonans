import { describe, it, expect } from 'vitest';
import {
	dispatchTimeoutMs,
	resolveDispatchBaseUrl,
	shouldReleaseClaimOnDispatchError
} from './cron-dispatch-logic';

describe('resolveDispatchBaseUrl', () => {
	it('defaulter til loopback på adapter-nodes port', () => {
		expect(resolveDispatchBaseUrl({})).toBe('http://127.0.0.1:3000');
		expect(resolveDispatchBaseUrl({ PORT: '3999' })).toBe('http://127.0.0.1:3999');
	});

	it('lar en eksplisitt base vinne, uten skråstrek på slutten', () => {
		expect(
			resolveDispatchBaseUrl({ CRON_DISPATCH_BASE_URL: 'https://resonans.apps.hoi.by/' })
		).toBe('https://resonans.apps.hoi.by');
	});

	it('ignorerer en tom/blank overstyring', () => {
		expect(resolveDispatchBaseUrl({ CRON_DISPATCH_BASE_URL: '  ', PORT: '3000' })).toBe(
			'http://127.0.0.1:3000'
		);
	});
});

describe('dispatchTimeoutMs', () => {
	it('bruker jobbens maxDurationSeconds', () => {
		expect(dispatchTimeoutMs({ maxDurationSeconds: 300 })).toBe(300_000);
	});

	it('defaulter til 30 s — samme som GitHub Actions-workflowen', () => {
		expect(dispatchTimeoutMs({})).toBe(30_000);
	});
});

describe('shouldReleaseClaimOnDispatchError', () => {
	it('slipper kravet ved nettverksfeil (forespørselen nådde aldri serveren)', () => {
		expect(shouldReleaseClaimOnDispatchError(new TypeError('fetch failed'))).toBe(true);
	});

	it('holder kravet ved timeout — jobben kjører videre på serveren', () => {
		const timeout = new Error('The operation was aborted due to timeout');
		timeout.name = 'TimeoutError';
		expect(shouldReleaseClaimOnDispatchError(timeout)).toBe(false);

		const abort = new Error('This operation was aborted');
		abort.name = 'AbortError';
		expect(shouldReleaseClaimOnDispatchError(abort)).toBe(false);
	});
});
