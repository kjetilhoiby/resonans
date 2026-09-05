import { describe, it, expect } from 'vitest';
import { shouldRetryBatch, retryDelayMs } from './import-retry';

describe('shouldRetryBatch', () => {
	it('prøver på nytt når forespørselen aldri nådde fram', () => {
		// Dette er tilfellet som felte importen: skjermen slo seg av og Safari
		// drepte fetchen. Serveren har ikke sagt noe, så vi vet ingenting ennå.
		expect(shouldRetryBatch({ kind: 'transport' })).toBe(true);
	});

	it('prøver på nytt ved 5xx', () => {
		expect(shouldRetryBatch({ kind: 'http', status: 500 })).toBe(true);
		expect(shouldRetryBatch({ kind: 'http', status: 502 })).toBe(true);
		expect(shouldRetryBatch({ kind: 'http', status: 503 })).toBe(true);
	});

	it('prøver på nytt ved 429 — «for fort» går over av seg selv', () => {
		expect(shouldRetryBatch({ kind: 'http', status: 429 })).toBe(true);
	});

	it('prøver IKKE på nytt ved 4xx: serveren mener det samme neste gang', () => {
		expect(shouldRetryBatch({ kind: 'http', status: 400 })).toBe(false);
		expect(shouldRetryBatch({ kind: 'http', status: 401 })).toBe(false);
		expect(shouldRetryBatch({ kind: 'http', status: 413 })).toBe(false);
	});

	it('prøver ikke på nytt ved 2xx/3xx — de er ikke feil å prøve om', () => {
		expect(shouldRetryBatch({ kind: 'http', status: 200 })).toBe(false);
		expect(shouldRetryBatch({ kind: 'http', status: 302 })).toBe(false);
	});
});

describe('retryDelayMs', () => {
	it('venter ikke før første forsøk', () => {
		expect(retryDelayMs(1, 1000)).toBe(0);
	});

	it('dobler for hvert nye forsøk', () => {
		expect(retryDelayMs(2, 1000)).toBe(1000);
		expect(retryDelayMs(3, 1000)).toBe(2000);
		expect(retryDelayMs(4, 1000)).toBe(4000);
	});

	it('følger basen den fikk', () => {
		expect(retryDelayMs(2, 250)).toBe(250);
		expect(retryDelayMs(3, 250)).toBe(500);
	});
});
