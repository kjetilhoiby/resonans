import { describe, it, expect } from 'vitest';
import { parseStreakInput } from './streak-input';

function ok(body: unknown, id?: string) {
	const result = parseStreakInput(body, id);
	if (!result.ok) throw new Error(`ventet gyldig input, fikk: ${result.error}`);
	return result.input;
}

function err(body: unknown): string {
	const result = parseStreakInput(body, undefined);
	if (result.ok) throw new Error('ventet valideringsfeil');
	return result.error;
}

describe('parseStreakInput', () => {
	it('godtar en daglig vane-streak', () => {
		const input = ok({
			title: ' Yoga ',
			emoji: '🧘',
			rule: 'consecutive_days',
			source: { kind: 'workout', sportFamily: 'yoga' }
		});
		expect(input.title).toBe('Yoga');
		expect(input.emoji).toBe('🧘');
		expect(input.source).toEqual({ kind: 'workout', sportFamily: 'yoga' });
		expect(input.config).toEqual({});
	});

	it('fyller inn standardverdier for uke-terskel', () => {
		const input = ok({
			title: 'Løping',
			rule: 'count_per_window',
			source: { kind: 'workout', sportFamily: 'running' }
		});
		expect(input.config).toEqual({ windowDays: 7, threshold: 1 });
	});

	it('beholder oppgitt terskel og periodelengde', () => {
		const input = ok({
			title: 'Løping',
			rule: 'count_per_window',
			source: { kind: 'workout', sportFamily: 'running' },
			config: { windowDays: 7, threshold: 2 }
		});
		expect(input.config).toEqual({ windowDays: 7, threshold: 2 });
	});

	it('godtar periodisk vedlikehold med intervall', () => {
		const input = ok({
			title: 'Hårklipp',
			rule: 'max_interval',
			source: { kind: 'manual' },
			config: { intervalDays: 5 }
		});
		expect(input.config).toEqual({ intervalDays: 5 });
		expect(input.source).toEqual({ kind: 'manual' });
	});

	it('tar med id ved oppdatering', () => {
		const input = ok(
			{ title: 'Yoga', rule: 'consecutive_days', source: { kind: 'manual' } },
			'abc-123'
		);
		expect(input.id).toBe('abc-123');
	});

	it('tar med textMatch for fritekst-hendelser', () => {
		const input = ok({
			title: 'Badevask',
			rule: 'max_interval',
			source: { kind: 'sensor_event', dataType: 'chore_done', textMatch: ' badevask ' },
			config: { intervalDays: 14 }
		});
		expect(input.source).toEqual({
			kind: 'sensor_event',
			dataType: 'chore_done',
			textMatch: 'badevask'
		});
	});

	it('utelater tom textMatch', () => {
		const input = ok({
			title: 'Husarbeid',
			rule: 'consecutive_days',
			source: { kind: 'sensor_event', dataType: 'chore_done', textMatch: '  ' }
		});
		expect(input.source).toEqual({ kind: 'sensor_event', dataType: 'chore_done' });
	});

	it('godtar pause-toleranse på «på rad»-regler', () => {
		const daily = ok({
			title: 'Yoga',
			rule: 'consecutive_days',
			source: { kind: 'workout', sportFamily: 'yoga' },
			config: { maxGapDays: 2, maxGaps: 1 }
		});
		expect(daily.config).toEqual({ maxGapDays: 2, maxGaps: 1 });

		const weekly = ok({
			title: 'Løping',
			rule: 'count_per_window',
			source: { kind: 'workout', sportFamily: 'running' },
			config: { threshold: 2, maxGapDays: 1 }
		});
		expect(weekly.config).toEqual({ windowDays: 7, threshold: 2, maxGapDays: 1 });
	});

	it('godtar maxGapDays: 0 som «ingen toleranse»', () => {
		const input = ok({
			title: 'Yoga',
			rule: 'consecutive_days',
			source: { kind: 'manual' },
			config: { maxGapDays: 0 }
		});
		expect(input.config).toEqual({ maxGapDays: 0 });
	});

	it('utelater pause-toleranse for max_interval', () => {
		const input = ok({
			title: 'Hårklipp',
			rule: 'max_interval',
			source: { kind: 'manual' },
			config: { intervalDays: 5, maxGapDays: 3 }
		});
		expect(input.config).toEqual({ intervalDays: 5 });
	});

	it('avviser ugyldig pause-toleranse', () => {
		expect(
			err({
				title: 'X',
				rule: 'consecutive_days',
				source: { kind: 'manual' },
				config: { maxGapDays: -1 }
			})
		).toMatch(/maxGapDays/);
		expect(
			err({
				title: 'X',
				rule: 'consecutive_days',
				source: { kind: 'manual' },
				config: { maxGaps: 0 }
			})
		).toMatch(/maxGaps/);
	});

	it('krever tittel', () => {
		expect(err({ rule: 'consecutive_days', source: { kind: 'manual' } })).toMatch(/title/);
	});

	it('avviser ukjent regel', () => {
		expect(err({ title: 'X', rule: 'hver_fullmåne', source: { kind: 'manual' } })).toMatch(/rule/);
	});

	it('avviser ukjent kilde', () => {
		expect(err({ title: 'X', rule: 'consecutive_days', source: { kind: 'tarot' } })).toMatch(
			/source.kind/
		);
	});

	it('krever sportFamily for workout', () => {
		expect(err({ title: 'X', rule: 'consecutive_days', source: { kind: 'workout' } })).toMatch(
			/sportFamily/
		);
	});

	it('krever dataType for sensor_event', () => {
		expect(err({ title: 'X', rule: 'consecutive_days', source: { kind: 'sensor_event' } })).toMatch(
			/dataType/
		);
	});

	it('krever intervalDays for max_interval', () => {
		expect(err({ title: 'X', rule: 'max_interval', source: { kind: 'manual' } })).toMatch(
			/intervalDays/
		);
	});

	it('avviser ikke-positive tall', () => {
		expect(
			err({
				title: 'X',
				rule: 'max_interval',
				source: { kind: 'manual' },
				config: { intervalDays: 0 }
			})
		).toMatch(/intervalDays/);
		expect(
			err({
				title: 'X',
				rule: 'count_per_window',
				source: { kind: 'manual' },
				config: { threshold: 1.5 }
			})
		).toMatch(/threshold/);
	});

	it('avviser tom body', () => {
		expect(err(null)).toMatch(/body/);
	});
});
