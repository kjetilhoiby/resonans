import { describe, it, expect } from 'vitest';
import { summarizeSleepForChat, MAX_NIGHTS, MAX_DISTURBANCE_NIGHTS, type SleepSummaryInput } from './sleep-summary';

function input(overrides: Partial<SleepSummaryInput> = {}): SleepSummaryInput {
	return {
		nights: [
			{ date: '2026-08-05', hours: 7.2, isNap: false },
			{ date: '2026-08-06', hours: 6.4, isNap: false },
			{ date: '2026-08-06', hours: 0.5, isNap: true },
			{ date: '2026-08-07', hours: 7.8, isNap: false }
		],
		rhythm: { bedtime: '23:12', wake: '06:30', avgHours: 7.1, nightCount: 3 },
		naps: [{ start: '2026-08-06T12:30:00Z', durationMinutes: 30, manual: true, note: 'kort dupp' }],
		disturbanceNights: [],
		goals: [],
		hrv: null,
		hrvAvailability: { sleepNights: 15, nightsWithHrv: 0 },
		sleepHeartRate: {
			latest: { date: '2026-08-07', restingBpm: 51, averageBpm: 58, segments: 2 },
			baselineBpm: 49,
			baselineNights: 12,
			deviationBpm: 2,
			band: 'normal'
		},
		breathing: null,
		latest: {
			avgHours: 7.1,
			sleepLag: 18,
			sleepHeartRate: 58,
			disturbedNights: 1,
			awakeMinutes: 40
		},
		...overrides
	};
}

describe('summarizeSleepForChat — recent', () => {
	it('holder dupper utenfor nettene, men teller dem', () => {
		const summary = summarizeSleepForChat(input(), 'recent');
		expect(summary.coverage.nights).toBe(3);
		expect(summary.coverage.naps).toBe(1);
		expect(summary.nights?.map((n) => n.date)).toEqual(['2026-08-05', '2026-08-06', '2026-08-07']);
	});

	it('viser de nyeste nettene når vinduet er fullt', () => {
		const nights = Array.from({ length: MAX_NIGHTS + 6 }, (_, i) => ({
			date: `2026-07-${String(i + 1).padStart(2, '0')}`,
			hours: 7,
			isNap: false
		}));
		const summary = summarizeSleepForChat(input({ nights }), 'recent');
		expect(summary.nights).toHaveLength(MAX_NIGHTS);
		// Siste natt skal være med — det er den man spør om.
		expect(summary.nights?.at(-1)?.date).toBe(nights.at(-1)?.date);
	});

	it('tar med søvnmålene med status', () => {
		const summary = summarizeSleepForChat(
			input({
				goals: [
					{
						title: 'Sove nok',
						kind: 'duration',
						evaluation: { currentLabel: '7,1t', targetLabel: 'minst 7,5t/natt', withinTarget: false, nightCount: 7 }
					}
				]
			}),
			'recent'
		);
		expect(summary.goals?.[0]).toEqual({
			title: 'Sove nok',
			kind: 'duration',
			current: '7,1t',
			target: 'minst 7,5t/natt',
			withinTarget: false,
			nightCount: 7
		});
	});

	it('tåler et mål uten netter i grunnlaget', () => {
		const summary = summarizeSleepForChat(
			input({
				goals: [
					{
						title: 'Legge seg tidlig',
						kind: 'bedtime',
						evaluation: { currentLabel: null, targetLabel: '23:00 ± 30 min', withinTarget: null, nightCount: 0 }
					}
				]
			}),
			'recent'
		);
		expect(summary.goals?.[0].current).toBeNull();
		expect(summary.goals?.[0].withinTarget).toBeNull();
	});
});

describe('summarizeSleepForChat — physiology', () => {
	it('skiller hvilepuls fra snittpuls og bærer avviket', () => {
		const summary = summarizeSleepForChat(input(), 'physiology');
		expect(summary.sleepHeartRate?.latestRestingBpm).toBe(51);
		expect(summary.sleepHeartRate?.latestAverageBpm).toBe(58);
		expect(summary.sleepHeartRate?.deviationBpm).toBe(2);
		// 2 segmenter = natta ble delt, ikke to netter.
		expect(summary.sleepHeartRate?.segments).toBe(2);
	});

	it('forklarer hvorfor HRV mangler framfor å utelate feltet', () => {
		const summary = summarizeSleepForChat(input(), 'physiology');
		expect(summary.hrv).toBeNull();
		expect(summary.hrvAvailability).toEqual({ sleepNights: 15, nightsWithHrv: 0 });
	});

	it('bærer «ukjent» videre når baselinen er for tynn', () => {
		const summary = summarizeSleepForChat(
			input({
				hrv: {
					latest: 41,
					latestDate: '2026-08-07',
					nights: 3,
					baseline: null,
					baselineNights: 2,
					deviationPct: null,
					band: 'ukjent'
				},
				hrvAvailability: { sleepNights: 15, nightsWithHrv: 3 }
			}),
			'physiology'
		);
		expect(summary.hrv?.band).toBe('ukjent');
		expect(summary.hrv?.deviationPct).toBeNull();
		expect(summary.hrv?.baselineSdnnMs).toBeNull();
	});
});

describe('summarizeSleepForChat — disturbances', () => {
	it('skiller «vet ikke» fra null minutter våken', () => {
		const summary = summarizeSleepForChat(
			input({
				disturbanceNights: [
					{ nightKey: '2026-08-07', innsovning: 1, oppvaakning: 2, awakeMinutes: 45 },
					{ nightKey: '2026-08-06', innsovning: 0, oppvaakning: 1, awakeMinutes: null }
				]
			}),
			'disturbances'
		);
		expect(summary.disturbances?.[0]).toEqual({
			night: '2026-08-07',
			couldNotFallAsleep: 1,
			wokeUp: 2,
			awakeMinutes: 45
		});
		expect(summary.disturbances?.[1].awakeMinutes).toBeNull();
	});

	it('klipper lange lister og sier det', () => {
		const disturbanceNights = Array.from({ length: MAX_DISTURBANCE_NIGHTS + 2 }, (_, i) => ({
			nightKey: `2026-07-${String(i + 1).padStart(2, '0')}`,
			innsovning: 1,
			oppvaakning: 0,
			awakeMinutes: null
		}));
		const summary = summarizeSleepForChat(input({ disturbanceNights }), 'disturbances');
		expect(summary.disturbances).toHaveLength(MAX_DISTURBANCE_NIGHTS);
		expect(summary.truncated).toBe(true);
	});
});
