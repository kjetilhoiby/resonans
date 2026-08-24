import { describe, it, expect } from 'vitest';
import { validateUpdateGoalArgs } from './update-goal';

describe('validateUpdateGoalArgs', () => {
	it('krever targetValue for adjust_target', () => {
		expect(validateUpdateGoalArgs({ action: 'adjust_target' })).toMatchObject({ ok: false });
		expect(validateUpdateGoalArgs({ action: 'adjust_target', targetValue: 98 })).toEqual({ ok: true });
	});

	it('avviser NaN som målverdi', () => {
		expect(validateUpdateGoalArgs({ action: 'adjust_target', targetValue: Number.NaN })).toMatchObject({
			ok: false
		});
	});

	it('godtar 0 som målverdi', () => {
		// `typeof === 'number'` framfor truthiness: et tak på 0 kr er et gyldig mål.
		expect(validateUpdateGoalArgs({ action: 'adjust_target', targetValue: 0 })).toEqual({ ok: true });
	});

	it('krever dato på riktig form for set_deadline', () => {
		expect(validateUpdateGoalArgs({ action: 'set_deadline' })).toMatchObject({ ok: false });
		expect(validateUpdateGoalArgs({ action: 'set_deadline', targetDate: '15. november' })).toMatchObject({
			ok: false
		});
		expect(validateUpdateGoalArgs({ action: 'set_deadline', targetDate: '2026-11-15' })).toEqual({
			ok: true
		});
	});

	it('avviser en dato som ikke finnes', () => {
		// Formen er riktig, datoen er det ikke. `new Date` ruller over til 3. mars.
		expect(validateUpdateGoalArgs({ action: 'set_deadline', targetDate: '2026-02-31' })).toMatchObject({
			ok: false
		});
	});

	it('slipper statusendringene gjennom uten ekstra felt', () => {
		for (const action of ['pause', 'resume', 'complete', 'abandon'] as const) {
			expect(validateUpdateGoalArgs({ action }), action).toEqual({ ok: true });
		}
	});

	it('avviser en ukjent action', () => {
		expect(validateUpdateGoalArgs({ action: 'delete' as never })).toMatchObject({ ok: false });
	});
});
