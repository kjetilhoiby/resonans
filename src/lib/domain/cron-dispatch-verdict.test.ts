import { describe, it, expect } from 'vitest';
import { describeDispatchStatus, summarizeClaimants } from './cron-dispatch-verdict';

describe('summarizeClaimants', () => {
	it('skiller dispatcher, GitHub Actions og resten', () => {
		const counts = summarizeClaimants([
			{ claimedBy: 'dispatcher-4324-mti8m0v1', count: 120 },
			{ claimedBy: 'dispatcher-99-abc', count: 30 },
			{ claimedBy: 'github-actions', count: 2 },
			{ claimedBy: null, count: 1 }
		]);
		expect(counts).toEqual({ internal: 150, github: 2, other: 1 });
	});
});

describe('describeDispatchStatus', () => {
	const ingen = { internal: 0, github: 0, other: 0 };

	it('sier fra når dispatcheren ikke er skrudd på', () => {
		const v = describeDispatchStatus({ enabled: false, lockHeld: false, counts: ingen });
		expect(v.tone).toBe('off');
		expect(v.text).toContain('ENABLE_CRON_DISPATCHER');
	});

	it('varsler når flagget er på men ingen holder lederlåsen', () => {
		const v = describeDispatchStatus({ enabled: true, lockHeld: false, counts: ingen });
		expect(v.tone).toBe('warn');
		expect(v.text).toContain('lederlåsen');
	});

	it('en holdt lås gjelder selv om DENNE instansen ikke har flagget', () => {
		// Rullende oppdatering: gammel container er leder mens ny svarer på web.
		const v = describeDispatchStatus({
			enabled: false,
			lockHeld: true,
			counts: { internal: 10, github: 0, other: 0 }
		});
		expect(v.tone).toBe('ok');
	});

	it('varsler når låsen holdes men ingen krav er tatt', () => {
		const v = describeDispatchStatus({ enabled: true, lockHeld: true, counts: ingen });
		expect(v.tone).toBe('warn');
		expect(v.text).toContain('ingen dispatch-krav');
	});

	it('varsler når GitHub Actions fortsatt tar slots', () => {
		const v = describeDispatchStatus({
			enabled: true,
			lockHeld: true,
			counts: { internal: 100, github: 3, other: 0 }
		});
		expect(v.tone).toBe('warn');
		expect(v.text).toContain('3 av 103');
	});

	it('grønt når dispatcheren vinner alt', () => {
		const v = describeDispatchStatus({
			enabled: true,
			lockHeld: true,
			counts: { internal: 240, github: 0, other: 0 }
		});
		expect(v.tone).toBe('ok');
		expect(v.text).toContain('240');
	});
});
