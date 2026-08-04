import { describe, it, expect } from 'vitest';
import {
	buildSleepHeartRateNights,
	summarizeSleepHeartRate,
	MIN_BASELINE_NIGHTS,
	NOTABLE_DEVIATION_BPM,
	type SleepHeartRateRow
} from './sleep-heart-rate';

function row(date: string, minBpm: number | null, averageBpm: number | null = null): SleepHeartRateRow {
	return { date, minBpm, averageBpm };
}

/** N netter med hvilepuls 52, eldste først. */
function baselineNights(count: number, bpm = 52): SleepHeartRateRow[] {
	return Array.from({ length: count }, (_, i) =>
		row(`2026-07-${String(i + 1).padStart(2, '0')}`, bpm, bpm + 6)
	);
}

describe('buildSleepHeartRateNights', () => {
	it('slår sammen segmenter fra samme natt', () => {
		// Withings deler natta når man er ute av senga — samme felle som nattlengdene.
		const nights = buildSleepHeartRateNights([
			row('2026-08-01', 54, 60),
			row('2026-08-01', 51, 58)
		]);
		expect(nights).toHaveLength(1);
		expect(nights[0].segments).toBe(2);
	});

	it('tar minimum av minimaene, ikke snittet av dem', () => {
		// Det laveste punktet gjennom natta er det laveste punktet, uansett hvor mange
		// biter måleren delte den i. Snitt ville gitt 52,5 for en oppdelt natt.
		const nights = buildSleepHeartRateNights([row('2026-08-01', 54), row('2026-08-01', 51)]);
		expect(nights[0].restingBpm).toBe(51);
	});

	it('snitter segmentenes snittpuls', () => {
		const nights = buildSleepHeartRateNights([
			row('2026-08-01', 54, 60),
			row('2026-08-01', 51, 56)
		]);
		expect(nights[0].averageBpm).toBe(58);
	});

	it('sorterer eldste først', () => {
		const nights = buildSleepHeartRateNights([
			row('2026-08-03', 52),
			row('2026-08-01', 51),
			row('2026-08-02', 53)
		]);
		expect(nights.map((n) => n.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
	});

	it('avviser puls utenfor menneskelige verdier', () => {
		const nights = buildSleepHeartRateNights([
			row('2026-08-01', 0),
			row('2026-08-02', 240),
			row('2026-08-03', 52)
		]);
		expect(nights[0].restingBpm).toBeNull();
		expect(nights[1].restingBpm).toBeNull();
		expect(nights[2].restingBpm).toBe(52);
	});

	it('beholder natta selv uten puls, med segmenttelling', () => {
		const nights = buildSleepHeartRateNights([row('2026-08-01', null, null)]);
		expect(nights).toHaveLength(1);
		expect(nights[0].restingBpm).toBeNull();
		expect(nights[0].segments).toBe(1);
	});

	it('ignorerer rader uten dato', () => {
		expect(buildSleepHeartRateNights([row('', 52)])).toEqual([]);
	});
});

describe('summarizeSleepHeartRate', () => {
	it('gir ukjent uten netter', () => {
		const summary = summarizeSleepHeartRate([]);
		expect(summary.latest).toBeNull();
		expect(summary.band).toBe('ukjent');
		expect(summary.baselineBpm).toBeNull();
	});

	it('venter med avvik til baselinen er bred nok', () => {
		const rows = [...baselineNights(MIN_BASELINE_NIGHTS - 1), row('2026-08-01', 60)];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.latest?.restingBpm).toBe(60);
		expect(summary.baselineBpm).toBeNull();
		expect(summary.baselineNights).toBe(MIN_BASELINE_NIGHTS - 1);
		expect(summary.band).toBe('ukjent');
	});

	it('flagger en natt med høyere puls enn vanlig', () => {
		// +8 slag: hard trening, dårlig restitusjon, alkohol eller sykdom.
		const rows = [...baselineNights(MIN_BASELINE_NIGHTS), row('2026-08-01', 60)];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.baselineBpm).toBe(52);
		expect(summary.deviationBpm).toBe(8);
		expect(summary.band).toBe('over');
	});

	it('kaller lavere puls «under», siden lavt er bra', () => {
		const rows = [...baselineNights(MIN_BASELINE_NIGHTS), row('2026-08-01', 45)];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.deviationBpm).toBe(-7);
		expect(summary.band).toBe('under');
	});

	it('holder små svingninger som normale', () => {
		for (const bpm of [52, 54, 50]) {
			const rows = [...baselineNights(MIN_BASELINE_NIGHTS), row('2026-08-01', bpm)];
			const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
			expect(Math.abs(summary.deviationBpm!)).toBeLessThan(NOTABLE_DEVIATION_BPM);
			expect(summary.band).toBe('normal');
		}
	});

	it('holder siste natt utenfor sin egen baseline', () => {
		// Var den med, ville en avvikende natt dratt snittet mot seg selv og dempet
		// sitt eget avvik.
		const rows = [...baselineNights(MIN_BASELINE_NIGHTS), row('2026-08-01', 70)];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.baselineBpm).toBe(52);
		expect(summary.baselineNights).toBe(MIN_BASELINE_NIGHTS);
	});

	it('bruker median, så én dårlig natt ikke flytter grunnlinja', () => {
		const rows = [
			...baselineNights(MIN_BASELINE_NIGHTS),
			row('2026-07-30', 110 - 40), // 70, en utligger
			row('2026-08-01', 53)
		];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.baselineBpm).toBe(52);
		expect(summary.band).toBe('normal');
	});

	it('ser bort fra netter uten hvilepuls i serien', () => {
		const rows = [...baselineNights(MIN_BASELINE_NIGHTS), row('2026-07-31', null), row('2026-08-01', 52)];
		const summary = summarizeSleepHeartRate(buildSleepHeartRateNights(rows));
		expect(summary.nights.every((n) => n.restingBpm !== null)).toBe(true);
		expect(summary.latest?.date).toBe('2026-08-01');
	});
});
