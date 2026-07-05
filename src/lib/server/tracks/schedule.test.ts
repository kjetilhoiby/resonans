import { describe, it, expect } from 'vitest';
import { suggestSessionForDate } from './schedule';
import type { SessionSuggestion } from './types';

const STYRKE: SessionSuggestion = { kind: 'strength', name: 'Styrke' };
const LOP: SessionSuggestion = { kind: 'run', name: 'Rolig løp' };

describe('suggestSessionForDate', () => {
	it('default: mandag eies av styrke', () => {
		// 2026-07-06 er en mandag
		const result = suggestSessionForDate('2026-07-06', undefined, STYRKE, LOP);
		expect(result.owner).toBe('styrke');
		expect(result.suggestion).toBe(STYRKE);
	});

	it('default: tirsdag eies av utholdenhet', () => {
		const result = suggestSessionForDate('2026-07-07', undefined, STYRKE, LOP);
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBe(LOP);
	});

	it('default: søndag er hviledag', () => {
		const result = suggestSessionForDate('2026-07-12', undefined, STYRKE, LOP);
		expect(result.owner).toBe('hvile');
		expect(result.suggestion).toBeNull();
	});

	it('planens schedule overstyrer default', () => {
		const schedule = { '1': 'utholdenhet' } as Record<string, 'styrke' | 'utholdenhet' | 'hvile'>;
		const result = suggestSessionForDate('2026-07-06', schedule, STYRKE, LOP);
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBe(LOP);
	});

	it('eierens motor kan si hvile (null) selv på treningsdag', () => {
		const result = suggestSessionForDate('2026-07-07', undefined, STYRKE, null);
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBeNull();
	});
});
