import { describe, it, expect } from 'vitest';
import {
	STUCK_AFTER_MINUTES,
	errorFingerprint,
	redactErrorText,
	toPublicError,
	toPublicJob,
	type BackgroundJobRow
} from './diagnostics-jobs';

const NOW = new Date('2026-09-04T12:00:00Z');

function job(overrides: Partial<BackgroundJobRow> = {}): BackgroundJobRow {
	return {
		type: 'sparebank1_historical_sync',
		status: 'running',
		attempts: 1,
		maxAttempts: 3,
		runAt: new Date('2026-09-04T11:00:00Z'),
		startedAt: new Date('2026-09-04T11:00:00Z'),
		lockedAt: new Date('2026-09-04T11:00:00Z'),
		lockedBy: 'worker-1234-abc',
		createdAt: new Date('2026-09-04T10:00:00Z'),
		payload: { fromDate: '2026-08-30', accountKey: 'HEMMELIG-KONTO' },
		result: { accountNames: ['Brukskonto Kjetil'] },
		error: 'Key (email)=(navn@example.com) already exists',
		userId: 'bruker-42',
		...overrides
	};
}

describe('toPublicJob', () => {
	it('slipper gjennom bare de trygge feltene', () => {
		expect(Object.keys(toPublicJob(job(), NOW)).sort()).toEqual([
			'attempts',
			'createdAt',
			'lockedBy',
			'maxAttempts',
			'runAt',
			'runningForMinutes',
			'startedAt',
			'status',
			'stuck',
			'type'
		]);
	});

	it('lekker ALDRI payload, result, error eller userId', () => {
		const s = JSON.stringify(toPublicJob(job(), NOW));
		expect(s).not.toContain('HEMMELIG-KONTO');
		expect(s).not.toContain('Brukskonto');
		expect(s).not.toContain('accountNames');
		expect(s).not.toContain('navn@example.com');
		expect(s).not.toContain('bruker-42');
		expect(s).not.toContain('fromDate');
	});

	it('tar ikke med felt som kommer til senere', () => {
		const medNytt = { ...job(), nyttFelt: 'hemmelig' } as BackgroundJobRow;
		expect(JSON.stringify(toPublicJob(medNytt, NOW))).not.toContain('hemmelig');
	});

	it('regner hvor lenge en running-jobb har stått', () => {
		expect(toPublicJob(job(), NOW).runningForMinutes).toBe(60);
	});

	it('flagger fastlåst etter terskelen, ikke før', () => {
		const started = (min: number) =>
			job({ startedAt: new Date(NOW.getTime() - min * 60_000) });
		expect(toPublicJob(started(STUCK_AFTER_MINUTES - 1), NOW).stuck).toBe(false);
		expect(toPublicJob(started(STUCK_AFTER_MINUTES), NOW).stuck).toBe(true);
	});

	// En ferdig eller køet jobb har ingen «kjører nå»-varighet å vise.
	it('gir null varighet og ikke fastlåst for andre statuser', () => {
		for (const status of ['completed', 'queued', 'failed', 'canceled']) {
			const p = toPublicJob(job({ status }), NOW);
			expect(p.runningForMinutes).toBeNull();
			expect(p.stuck).toBe(false);
		}
	});

	it('faller tilbake på lockedAt når startedAt mangler', () => {
		expect(toPublicJob(job({ startedAt: null }), NOW).runningForMinutes).toBe(60);
		expect(toPublicJob(job({ startedAt: null, lockedAt: null }), NOW).runningForMinutes).toBeNull();
	});
});

describe('redactErrorText', () => {
	// Den konkrete lekkasjen regelen finnes for: Postgres bygger verdien inn.
	it('fjerner verdien i en Postgres-constraint, men beholder kolonnen', () => {
		const r = redactErrorText(
			'duplicate key value violates unique constraint "users_email_unique" Key (email)=(navn@example.com) already exists'
		);
		expect(r).toContain('Key (email)=(<redigert>)');
		expect(r).not.toContain('navn@example.com');
		// Kolonnenavnet er nyttig og trygt.
		expect(r).toContain('users_email_unique');
	});

	it('fjerner e-poster, lange sifferrekker og URL-spørrestrenger', () => {
		expect(redactErrorText('kontakt ola@example.com')).not.toContain('ola@');
		expect(redactErrorText('konto 12345678 avvist')).toBe('konto <tall> avvist');
		const u = redactErrorText('GET https://api.sb1.no/accounts?token=abc123&id=9');
		expect(u).not.toContain('token=abc');
		expect(u).toContain('https://api.sb1.no/accounts');
	});

	it('kapper alt etter DETAIL — der ligger radinnholdet', () => {
		const r = redactErrorText('insert failed\nDETAIL: Row (1, Brukskonto Kjetil) conflicts');
		expect(r).not.toContain('Brukskonto');
	});

	it('tar bare første linje, og kapper lengden', () => {
		expect(redactErrorText('linje en\nlinje to')).toBe('linje en');
		expect(redactErrorText('x'.repeat(500)).length).toBeLessThanOrEqual(201);
		expect(redactErrorText('x'.repeat(500))).toMatch(/…$/);
	});

	it('lar en harmløs melding stå lesbar — poenget er å kunne feilsøke', () => {
		const raw = 'The "string" argument must be of type string. Received an instance of Array';
		expect(redactErrorText(raw)).toBe(raw);
	});
});

describe('errorFingerprint', () => {
	it('er stabilt for samme tekst og ulikt for ulik', () => {
		expect(errorFingerprint('samme feil')).toBe(errorFingerprint('samme feil'));
		expect(errorFingerprint('feil A')).not.toBe(errorFingerprint('feil B'));
	});

	it('røper ikke innholdet', () => {
		const fp = errorFingerprint('Key (email)=(navn@example.com)');
		expect(fp).toMatch(/^[0-9a-f]{8}$/);
		expect(fp).not.toContain('navn');
	});
});

describe('toPublicError', () => {
	it('gir fingeravtrykk og lengde UTEN tekst når gaten er av', () => {
		const e = toPublicError('Key (email)=(navn@example.com) finnes', false);
		expect(e?.redacted).toBeUndefined();
		expect(e?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
		expect(e?.length).toBeGreaterThan(0);
		expect(JSON.stringify(e)).not.toContain('navn@example.com');
	});

	it('gir redigert tekst når gaten er på', () => {
		const e = toPublicError('Key (email)=(navn@example.com) finnes', true);
		expect(e?.redacted).toContain('<redigert>');
		expect(JSON.stringify(e)).not.toContain('navn@example.com');
	});

	it('gir null for ingen feil', () => {
		expect(toPublicError(null, true)).toBeNull();
		expect(toPublicError('', true)).toBeNull();
	});
});
