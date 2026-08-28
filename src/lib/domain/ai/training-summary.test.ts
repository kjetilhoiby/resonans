import { describe, it, expect } from 'vitest';
import {
	summarizeLoad,
	summarizeTrainingForChat,
	MAX_RECENT_SESSIONS,
	type TrainingSummaryInput
} from './training-summary';

/** Serie med konstant effort per dag, eldste først — som `mapDailyEffortSeries` gir. */
function flatSeries(days: number, effort: number, endDate = '2026-08-07') {
	const end = Date.parse(`${endDate}T00:00:00Z`);
	return Array.from({ length: days }, (_, i) => ({
		date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
		effort
	}));
}

function input(overrides: Partial<TrainingSummaryInput> = {}): TrainingSummaryInput {
	return {
		plan: { name: 'Høstløpet', startDate: '2026-06-01', durationWeeks: 16 },
		dailyEffort: flatSeries(60, 60),
		vo2max: null,
		hrRecovery: null,
		states: null,
		milestones: [],
		...overrides
	};
}

const budget = {
	bandMin: 232,
	bandMax: 278,
	spentThisWeek: 426,
	remainingMin: 0,
	remainingMax: 0,
	acuteChronicRatio: 1.48,
	restRecommended: false,
	deload: false,
	anchor: 'snitt_uker',
	anchorWeeks: 4,
	maintenance: false
};

describe('summarizeLoad', () => {
	it('gir null-tall og «Ingen data» for en tom serie', () => {
		const load = summarizeLoad([]);
		expect(load.ctl).toBeNull();
		expect(load.tsb).toBeNull();
		expect(load.status.label).toBe('Ingen data');
		expect(load.ctlSettled).toBe(false);
	});

	it('bruker samme TSB-grenser som kortet på flaten', () => {
		// Fire uker uten trening etter et halvt år med jevn belastning: ATL faller
		// raskere enn CTL, så TSB blir godt positiv.
		const series = [...flatSeries(180, 70, '2026-07-10'), ...flatSeries(28, 0, '2026-08-07')];
		const load = summarizeLoad(series);
		expect(load.tsb).toBeGreaterThan(15);
		expect(load.status.label).toBe('Veldig fersk');
	});

	it('melder sliten når akutt belastning ligger over formen', () => {
		// Rolig grunnlag, så en hard uke: ATL skyter opp, CTL henger etter.
		const series = [...flatSeries(120, 30, '2026-07-31'), ...flatSeries(7, 70, '2026-08-07')];
		const load = summarizeLoad(series);
		expect(load.tsb).toBeLessThan(-10);
		expect(load.status.label).toBe('Sliten');

		// Dobler man den harde uka, faller man over i neste bånd — grensene er kortets.
		const brutal = [...flatSeries(120, 30, '2026-07-31'), ...flatSeries(7, 140, '2026-08-07')];
		expect(summarizeLoad(brutal).status.label).toBe('Veldig sliten');
	});

	it('flagger at CTL ikke har svingt inn på en kort serie', () => {
		expect(summarizeLoad(flatSeries(20, 60)).ctlSettled).toBe(false);
		expect(summarizeLoad(flatSeries(42, 60)).ctlSettled).toBe(true);
	});

	it('regner CTL-endringen over fjorten dager, og utelater den når serien er kortere', () => {
		// Stigende belastning ⇒ CTL skal ha steget de siste to ukene.
		const rising = [...flatSeries(60, 30, '2026-07-24'), ...flatSeries(14, 120, '2026-08-07')];
		const load = summarizeLoad(rising);
		expect(load.ctlChange).not.toBeNull();
		expect(load.ctlChange!).toBeGreaterThan(0);

		expect(summarizeLoad(flatSeries(10, 60)).ctlChange).toBeNull();
	});
});

describe('summarizeTrainingForChat — load', () => {
	it('plasserer uka mot båndet: over, under eller i band', () => {
		const over = summarizeTrainingForChat(input({ states: { budget } }), 'load');
		expect(over.week?.standing).toBe('over');
		expect(over.week?.spentEffort).toBe(426);
		expect(over.week?.bandMin).toBe(232);

		const under = summarizeTrainingForChat(
			input({ states: { budget: { ...budget, spentThisWeek: 100 } } }),
			'load'
		);
		expect(under.week?.standing).toBe('under');

		const inBand = summarizeTrainingForChat(
			input({ states: { budget: { ...budget, spentThisWeek: 250 } } }),
			'load'
		);
		expect(inBand.week?.standing).toBe('i_band');
	});

	it('sier om prognosen lander under båndet — det er da et råd har effekt', () => {
		const summary = summarizeTrainingForChat(
			input({
				states: {
					budget: { ...budget, spentThisWeek: 120 },
					projection: { expectedRemaining: 65, projectedTotal: 185, remainingDays: 2 }
				}
			}),
			'load'
		);
		expect(summary.week?.projectedTotal).toBe(185);
		expect(summary.week?.projectionBelowBand).toBe(true);
	});

	it('lar prognosefeltene være null når prognosen mangler', () => {
		const summary = summarizeTrainingForChat(input({ states: { budget } }), 'load');
		expect(summary.week?.projectedTotal).toBeNull();
		expect(summary.week?.projectionBelowBand).toBeNull();
	});

	it('gir uka som null uten treningsløp, men beholder belastningen', () => {
		const summary = summarizeTrainingForChat(input({ plan: null, states: null }), 'load');
		expect(summary.week).toBeNull();
		expect(summary.hasPlan).toBe(false);
		expect(summary.note).toContain('Ingen aktivt treningsløp');
		// Belastningsserien er uavhengig av løpet — den skal fortsatt være der.
		expect(summary.load!.ctl).not.toBeNull();
	});
});

describe('summarizeTrainingForChat — balance', () => {
	it('beholder rekkefølgen på disiplinene og nudgen som peker på avviket', () => {
		const summary = summarizeTrainingForChat(
			input({
				states: {
					balance: {
						disciplines: [
							{ family: 'running', effort: 650.4, sessions: 12, pct: 65 },
							{ family: 'walking', effort: 190, sessions: 8, pct: 19 }
						],
						totalEffort: 1000,
						strengthSessionsThisWeek: 0,
						runSessionsThisWeek: 4,
						intensity: { rolig: 85, moderat: 15, hard: 0 },
						score: 36,
						nudge: { kind: 'styrke', message: '4 løp og ingen styrke denne uka', severity: 'medium' }
					}
				}
			}),
			'balance'
		);

		expect(summary.balance?.score).toBe(36);
		expect(summary.balance?.disciplines[0]).toEqual({
			family: 'running',
			pct: 65,
			sessions: 12,
			effort: 650
		});
		expect(summary.balance?.nudge?.kind).toBe('styrke');
	});
});

describe('summarizeTrainingForChat — capacity', () => {
	it('leder med beste observasjon og sier hvilket vindu den gjelder', () => {
		const summary = summarizeTrainingForChat(
			input({
				vo2max: {
					best: 42.83,
					latest: 33.7,
					source: 'withings',
					confidence: 0.9,
					samples: 6,
					bestAt: '2026-08-01T10:00:00Z'
				},
				hrRecovery: {
					best: 32,
					latest: 22,
					band: 'god',
					samples: 13,
					bestAt: '2026-08-04T18:00:00Z',
					bestEndBpm: 127,
					bestPeakBpm: 159,
					wellAnchored: true,
					sportFamily: 'running'
				}
			}),
			'capacity'
		);

		expect(summary.capacity!.vo2max).toMatchObject({ best: 42.8, latest: 33.7, window: 'siste åtte uker' });
		expect(summary.capacity!.hrRecovery).toMatchObject({
			bestDropBpm: 32,
			fromBpm: 159,
			toBpm: 127,
			wellAnchored: true
		});
		expect(summary.capacity!.missing).toEqual([]);
	});

	it('navngir hva som mangler framfor å utelate det stille', () => {
		const summary = summarizeTrainingForChat(input(), 'capacity');
		expect(summary.capacity!.vo2max).toBeNull();
		expect(summary.capacity!.missing).toEqual(['vo2max', 'pulsfall']);
	});
});

describe('summarizeTrainingForChat — sessions', () => {
	it('klipper lista og sier at den er klippet', () => {
		const workouts = Array.from({ length: MAX_RECENT_SESSIONS + 3 }, (_, i) => ({
			date: `2026-08-0${(i % 7) + 1}`,
			family: 'running',
			effortScore: 65.6,
			distanceMeters: 6900,
			durationSeconds: 2400
		}));

		const summary = summarizeTrainingForChat(
			input({ states: { recentEnduranceWorkouts: workouts } }),
			'sessions'
		);
		expect(summary.sessions!.count).toBe(MAX_RECENT_SESSIONS + 3);
		expect(summary.sessions!.workouts).toHaveLength(MAX_RECENT_SESSIONS);
		expect(summary.sessions!.truncated).toBe(true);
		expect(summary.sessions!.workouts[0]).toMatchObject({ effort: 66, km: 6.9, minutes: 40 });
	});

	it('beholder null for felt økta ikke målte', () => {
		const summary = summarizeTrainingForChat(
			input({
				states: {
					recentEnduranceWorkouts: [
						{ date: '2026-08-05', family: 'football', effortScore: null, distanceMeters: null, durationSeconds: 3600 }
					]
				}
			}),
			'sessions'
		);
		expect(summary.sessions!.workouts[0]).toEqual({
			date: '2026-08-05',
			family: 'football',
			effort: null,
			km: null,
			minutes: 60
		});
	});
});

describe('summarizeTrainingForChat — plan', () => {
	it('teller nådde milepæler og viser de nyeste først', () => {
		const summary = summarizeTrainingForChat(
			input({
				milestones: [
					{ name: '10 armhevinger', achievedAt: '2026-07-01T00:00:00Z' },
					{ name: '5 km under 25 min', achievedAt: '2026-08-01T00:00:00Z' },
					{ name: 'Planke 90 sek', achievedAt: null }
				]
			}),
			'plan'
		);

		expect(summary.plan?.milestones.achieved).toBe(2);
		expect(summary.plan?.milestones.total).toBe(3);
		expect(summary.plan?.milestones.recentlyAchieved[0].name).toBe('5 km under 25 min');
		expect(summary.plan?.milestones.pending).toEqual(['Planke 90 sek']);
	});

	it('gir null uten treningsløp', () => {
		expect(summarizeTrainingForChat(input({ plan: null }), 'plan').plan).toBeNull();
	});
});

describe('summarizeVolume', () => {
	const base = {
		plan: null,
		dailyEffort: [],
		vo2max: null,
		hrRecovery: null,
		states: null
	} as unknown as TrainingSummaryInput;

	it('sier fra når det ikke finnes løpeturer', () => {
		const summary = summarizeTrainingForChat(base, 'volume');
		expect(summary.volume).toEqual({
			available: false,
			note: 'Ingen registrerte løpeturer å summere.'
		});
	});

	it('sammenligner mot samme dag i fjor, ikke mot fjorårets sluttall', () => {
		const summary = summarizeTrainingForChat(
			{
				...base,
				runningHistory: {
					today: '2026-03-01',
					days: [
						{ date: '2025-01-10', value: 100 },
						{ date: '2025-09-10', value: 400 },
						{ date: '2026-01-10', value: 130 }
					]
				}
			},
			'volume'
		);

		expect(summary.volume?.available).toBe(true);
		const year = summary.volume!.available ? summary.volume!.year : null;
		expect(year!.totalKm).toBe(130);
		// Fjoråret sto på 100 km på dag 10, ikke på 500 der året endte.
		expect(year!.previous).toEqual({ label: '2025', km: 100 });
		expect(year!.sentence).toBe('30 km foran i fjor på samme dato.');
		// Sluttallet finnes, men i completed — det er et annet spørsmål.
		expect(year!.completed).toEqual([{ label: '2025', km: 500 }]);
	});
});
