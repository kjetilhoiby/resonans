import { describe, it, expect } from 'vitest';
import {
	decideStaleJob,
	LEASE_EXPIRY_MINUTES,
	ABANDONED_AFTER_MINUTES,
	type StaleJobRow
} from './stale-jobs';

const NOW = new Date('2026-09-04T12:00:00Z');

function minutesAgo(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * 60_000);
}

function row(overrides: Partial<StaleJobRow> = {}): StaleJobRow {
	return {
		status: 'running',
		attempts: 1,
		maxAttempts: 3,
		lockedAt: null,
		lockedBy: null,
		updatedAt: minutesAgo(1),
		...overrides
	};
}

describe('decideStaleJob', () => {
	it('lar alt som ikke er running stå', () => {
		for (const status of ['queued', 'retry', 'completed', 'failed', 'canceled']) {
			expect(decideStaleJob(row({ status, updatedAt: minutesAgo(40_000) }), NOW).outcome).toBe(
				'leave'
			);
		}
	});

	describe('eier som kanskje lever', () => {
		it('lar en fersk lease stå', () => {
			const decision = decideStaleJob(
				row({ lockedBy: 'worker-42-mf3k1', lockedAt: minutesAgo(LEASE_EXPIRY_MINUTES - 1) }),
				NOW
			);
			expect(decision.outcome).toBe('leave');
		});

		it('lar en lang, men levende jobb stå — en backfill tar tid', () => {
			const decision = decideStaleJob(
				row({ lockedBy: 'worker-42-mf3k1', lockedAt: minutesAgo(45) }),
				NOW
			);
			expect(decision.outcome).toBe('leave');
		});

		it('legger en utløpt lease tilbake i køen når det er forsøk igjen', () => {
			const decision = decideStaleJob(
				row({
					lockedBy: 'worker-42-mf3k1',
					lockedAt: minutesAgo(LEASE_EXPIRY_MINUTES + 1),
					attempts: 1,
					maxAttempts: 3
				}),
				NOW
			);
			expect(decision.outcome).toBe('retry');
			expect(decision.reason).toContain('leasen utløp');
		});

		it('feiler en utløpt lease når forsøkene er brukt opp', () => {
			const decision = decideStaleJob(
				row({
					lockedBy: 'worker-42-mf3k1',
					lockedAt: minutesAgo(LEASE_EXPIRY_MINUTES + 1),
					attempts: 3,
					maxAttempts: 3
				}),
				NOW
			);
			expect(decision.outcome).toBe('fail');
		});

		it('faller tilbake på updated_at når en eier mangler lease-klokke', () => {
			expect(
				decideStaleJob(
					row({ lockedBy: 'worker-42-mf3k1', lockedAt: null, updatedAt: minutesAgo(5) }),
					NOW
				).outcome
			).toBe('leave');

			expect(
				decideStaleJob(
					row({
						lockedBy: 'worker-42-mf3k1',
						lockedAt: null,
						updatedAt: minutesAgo(LEASE_EXPIRY_MINUTES + 1)
					}),
					NOW
				).outcome
			).toBe('retry');
		});

		it('feiler ikke en eier bare fordi begge tidsstemplene mangler — den retryes', () => {
			const decision = decideStaleJob(
				row({ lockedBy: 'worker-42-mf3k1', lockedAt: null, updatedAt: null }),
				NOW
			);
			expect(decision.outcome).toBe('retry');
		});
	});

	describe('ingen eier', () => {
		it('lar en batch som fortsatt steppes fra nettleseren stå', () => {
			const decision = decideStaleJob(
				row({ lockedBy: null, lockedAt: null, updatedAt: minutesAgo(2) }),
				NOW
			);
			expect(decision.outcome).toBe('leave');
		});

		it('lar en treg batch stå helt til stillheten er lang nok', () => {
			expect(
				decideStaleJob(
					row({ updatedAt: minutesAgo(ABANDONED_AFTER_MINUTES - 1) }),
					NOW
				).outcome
			).toBe('leave');
		});

		it('feiler en forlatt batch — ingen worker kan overta den', () => {
			const decision = decideStaleJob(
				row({ attempts: 0, maxAttempts: 3, updatedAt: minutesAgo(28 * 24 * 60) }),
				NOW
			);
			expect(decision.outcome).toBe('fail');
			expect(decision.reason).toContain('uten eier');
		});

		it('requeuer ALDRI en eierløs jobb, heller ikke med forsøk igjen', () => {
			const decision = decideStaleJob(
				row({ attempts: 0, maxAttempts: 5, updatedAt: minutesAgo(ABANDONED_AFTER_MINUTES + 1) }),
				NOW
			);
			expect(decision.outcome).toBe('fail');
		});

		it('feiler en eierløs rad uten updated_at', () => {
			expect(decideStaleJob(row({ updatedAt: null }), NOW).outcome).toBe('fail');
		});
	});

	it('skiller de tre radene i prod fra en levende worker-jobb', () => {
		// De tre `batch:withings_backfill`-radene: running, ingen eier, 28 døgn.
		const forlatt = decideStaleJob(
			row({ attempts: 0, lockedBy: null, lockedAt: null, updatedAt: minutesAgo(40_140) }),
			NOW
		);
		// En worker som plukket en jobb for ti minutter siden.
		const lever = decideStaleJob(
			row({ lockedBy: 'worker-1-mf3k1', lockedAt: minutesAgo(10), updatedAt: minutesAgo(10) }),
			NOW
		);

		expect([forlatt.outcome, lever.outcome]).toEqual(['fail', 'leave']);
	});
});
