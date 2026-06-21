import { describe, it, expect } from 'vitest';
import { pickRecentCompletedSessions, type CompletableSession } from './recent-sessions';

interface TestSession extends CompletableSession {
	name: string;
}

function session(name: string, completedAt: string | null): TestSession {
	return { name, completion: completedAt ? { completedAt } : null };
}

describe('pickRecentCompletedSessions', () => {
	it('tar bare med fullførte økter', () => {
		const result = pickRecentCompletedSessions(
			[session('a', '2026-06-01T10:00:00Z'), session('b', null), session('c', '2026-06-02T10:00:00Z')],
			10
		);
		expect(result.map((s) => s.name)).toEqual(['c', 'a']);
	});

	it('sorterer nyeste fullføring først', () => {
		const result = pickRecentCompletedSessions(
			[
				session('eldst', '2026-06-01T08:00:00Z'),
				session('nyest', '2026-06-10T08:00:00Z'),
				session('midt', '2026-06-05T08:00:00Z')
			],
			10
		);
		expect(result.map((s) => s.name)).toEqual(['nyest', 'midt', 'eldst']);
	});

	it('klipper til limit', () => {
		const sessions = Array.from({ length: 12 }, (_, i) =>
			session(`s${i}`, `2026-06-${String(i + 1).padStart(2, '0')}T08:00:00Z`)
		);
		const result = pickRecentCompletedSessions(sessions, 7);
		expect(result).toHaveLength(7);
		expect(result[0].name).toBe('s11'); // nyeste først
	});

	it('returnerer tomt ved limit 0 eller negativ', () => {
		expect(pickRecentCompletedSessions([session('a', '2026-06-01T08:00:00Z')], 0)).toHaveLength(0);
		expect(pickRecentCompletedSessions([session('a', '2026-06-01T08:00:00Z')], -3)).toHaveLength(0);
	});

	it('håndterer tom liste', () => {
		expect(pickRecentCompletedSessions([], 5)).toHaveLength(0);
	});
});
