import { describe, it, expect } from 'vitest';
import { parseGoalIntent } from './goal-intent-parser';

describe('parseGoalIntent', () => {
	describe('løping', () => {
		it('parser "løpe 3 ganger i uken"', () => {
			const r = parseGoalIntent('løpe 3 ganger i uken');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('running');
			expect(r.intent?.threshold).toBe(3);
			expect(r.intent?.signalType).toBe('activity_run_pr_week');
		});

		it('parser "løping 5 ganger per uke"', () => {
			const r = parseGoalIntent('løping 5 ganger per uke');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('running');
			expect(r.intent?.threshold).toBe(5);
		});

		it('parser "running 4 ganger i uka"', () => {
			const r = parseGoalIntent('running 4 ganger i uka');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('running');
			expect(r.intent?.threshold).toBe(4);
		});
	});

	describe('generiske aktiviteter', () => {
		it('parser "yoga 3 ganger i uken"', () => {
			const r = parseGoalIntent('yoga 3 ganger i uken');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('yoga');
			expect(r.intent?.threshold).toBe(3);
			expect(r.intent?.signalType).toBe('tracking_series_activity_pr_week');
		});

		it('parser "styrketrening 2 ganger per uke"', () => {
			const r = parseGoalIntent('styrketrening 2 ganger per uke');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('styrketrening');
			expect(r.intent?.threshold).toBe(2);
		});

		it('parser "svømming tre ganger i uken" (tallord)', () => {
			const r = parseGoalIntent('svømming tre ganger i uken');
			expect(r.matched).toBe(true);
			expect(r.intent?.activityType).toBe('svomming');
			expect(r.intent?.threshold).toBe(3);
		});
	});

	describe('tallord', () => {
		it('parser norske tallord (flertall "ganger")', () => {
			expect(parseGoalIntent('yoga to ganger i uken').intent?.threshold).toBe(2);
			expect(parseGoalIntent('yoga tre ganger i uken').intent?.threshold).toBe(3);
			expect(parseGoalIntent('yoga fire ganger i uken').intent?.threshold).toBe(4);
			expect(parseGoalIntent('yoga syv ganger i uken').intent?.threshold).toBe(7);
			expect(parseGoalIntent('yoga sju ganger i uken').intent?.threshold).toBe(7);
		});

		it('matcher ikke entall "gang" (regex krever "ganger")', () => {
			expect(parseGoalIntent('yoga en gang i uken').matched).toBe(false);
		});
	});

	describe('perioder', () => {
		it('godtar "i uken", "per uke", "i uka"', () => {
			expect(parseGoalIntent('yoga 3 ganger i uken').matched).toBe(true);
			expect(parseGoalIntent('yoga 3 ganger per uke').matched).toBe(true);
			expect(parseGoalIntent('yoga 3 ganger i uka').matched).toBe(true);
		});

		it('godtar "pr." som forkortelse', () => {
			expect(parseGoalIntent('yoga 3 ganger pr. uke').matched).toBe(true);
		});
	});

	describe('ikke-matchende input', () => {
		it('avviser tom tekst', () => {
			const r = parseGoalIntent('');
			expect(r.matched).toBe(false);
			expect(r.reason).toBe('empty_text');
		});

		it('avviser tekst uten frekvens-mønster', () => {
			const r = parseGoalIntent('Bli bedre til å løpe');
			expect(r.matched).toBe(false);
			expect(r.reason).toBe('unsupported_period_or_threshold');
		});

		it('avviser daglig frekvens', () => {
			const r = parseGoalIntent('yoga 3 ganger om dagen');
			expect(r.matched).toBe(false);
		});

		it('avviser månedlig frekvens', () => {
			const r = parseGoalIntent('yoga 3 ganger i måneden');
			expect(r.matched).toBe(false);
		});
	});

	describe('returformat', () => {
		it('setter parser til "rule"', () => {
			expect(parseGoalIntent('yoga 3 ganger i uken').parser).toBe('rule');
		});

		it('setter period til "week"', () => {
			expect(parseGoalIntent('yoga 3 ganger i uken').intent?.period).toBe('week');
		});

		it('setter comparator til ">="', () => {
			expect(parseGoalIntent('yoga 3 ganger i uken').intent?.comparator).toBe('>=');
		});

		it('beholder sourceText', () => {
			expect(parseGoalIntent('yoga 3 ganger i uken').intent?.sourceText).toBe('yoga 3 ganger i uken');
		});
	});
});
