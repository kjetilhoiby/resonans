import { describe, it, expect } from 'vitest';
import { summarizeWeightForChat, MAX_MILESTONES, type WeightSummaryInput } from './weight-summary';
import type { WeightDay } from '$lib/domain/health/weight-series';

function day(date: string, weightKg: number, extra: Partial<WeightDay> = {}): WeightDay {
	return {
		date,
		weightKg,
		weighInCount: 1,
		fatMassKg: null,
		fatRatio: null,
		muscleMassKg: null,
		fatFreeMassKg: null,
		...extra
	};
}

/** Daglige veiinger som faller jevnt — nok punkter til at trenden finnes. */
function decliningDays(count: number, startKg: number, perDayKg: number, from = '2026-05-01') {
	const start = Date.parse(`${from}T00:00:00Z`);
	return Array.from({ length: count }, (_, i) =>
		day(
			new Date(start + i * 86_400_000).toISOString().slice(0, 10),
			Math.round((startKg - i * perDayKg) * 100) / 100
		)
	);
}

function input(overrides: Partial<WeightSummaryInput> = {}): WeightSummaryInput {
	const days = decliningDays(120, 88, 0.03);
	return {
		days,
		milestones: [],
		historyDays: 119,
		weighIns: days.length,
		enoughHistory: true,
		goalKg: null,
		composition: null,
		latest: days.at(-1) ?? null,
		today: days.at(-1)!.date,
		...overrides
	};
}

describe('summarizeWeightForChat — trend', () => {
	it('leder med trendverdien, ikke med siste måling', () => {
		const days = [...decliningDays(30, 85, 0.05), day('2026-05-31', 83.0)];
		const summary = summarizeWeightForChat(
			input({ days, latest: days.at(-1), today: '2026-05-31', weighIns: days.length })
		);

		// Siste måling er en utligger; trenden skal ligge over den.
		expect(summary.latest?.weightKg).toBe(83.0);
		expect(summary.trendKg).not.toBeNull();
		expect(summary.trendKg!).toBeGreaterThan(83.0);
	});

	it('regner endring over 7, 30 og 90 dager på trenden', () => {
		const summary = summarizeWeightForChat(input());
		expect(summary.changes!.map((c) => c.windowDays)).toEqual([7, 30, 90]);
		// Jevn nedgang på 0,03 kg/dag ⇒ ~0,9 kg på 30 dager, og alle negative.
		for (const change of summary.changes!) expect(change.deltaKg).toBeLessThan(0);
		expect(summary.changes![1].deltaKg).toBeCloseTo(-0.9, 1);
	});

	it('sier hvor langt tilbake referansepunktet faktisk lå', () => {
		// Ingen veiinger mellom mai og august: «siste 7 dager» ville ellers blitt
		// regnet fra en måling i mai uten at noe sa fra.
		const days = [...decliningDays(20, 90, 0.05, '2026-05-01'), day('2026-08-05', 86), day('2026-08-06', 85.9), day('2026-08-07', 85.8)];
		const summary = summarizeWeightForChat(
			input({ days, latest: days.at(-1), today: '2026-08-07', weighIns: days.length })
		);

		const week = summary.changes!.find((c) => c.windowDays === 7);
		expect(week).toBeDefined();
		expect(week!.actualDays).toBeGreaterThan(60);
		expect(week!.fromDate).toBe('2026-05-20');
	});

	it('utelater et vindu framfor å rapportere 0 når historikken er kortere', () => {
		const days = decliningDays(12, 84, 0.05);
		const summary = summarizeWeightForChat(
			input({ days, latest: days.at(-1), today: days.at(-1)!.date, weighIns: days.length })
		);
		expect(summary.changes!.map((c) => c.windowDays)).toEqual([7]);
	});

	it('måler avstanden til målet mot trenden', () => {
		const summary = summarizeWeightForChat(input({ goalKg: 80 }));
		expect(summary.goal?.remainingKg).toBeCloseTo(summary.trendKg! - 80, 5);
		expect(summary.goal?.reached).toBe(false);

		const reached = summarizeWeightForChat(input({ goalKg: 95 }));
		expect(reached.goal?.reached).toBe(true);
	});

	it('bærer dekningen så modellen ikke kaller noe rekord uten grunnlag', () => {
		const summary = summarizeWeightForChat(input({ enoughHistory: false, weighIns: 4, historyDays: 9 }));
		expect(summary.coverage.enoughHistory).toBe(false);
		expect(summary.coverage.weighIns).toBe(4);
	});

	it('teller dager siden siste veiing', () => {
		const days = decliningDays(40, 86, 0.02, '2026-06-01');
		const summary = summarizeWeightForChat(
			input({ days, latest: days.at(-1), today: '2026-07-20', weighIns: days.length })
		);
		expect(summary.coverage.latestWeighIn).toBe('2026-07-10');
		expect(summary.coverage.daysSinceLatest).toBe(10);
	});

	it('tåler tom historikk', () => {
		const summary = summarizeWeightForChat(
			input({ days: [], latest: null, weighIns: 0, historyDays: 0, enoughHistory: false, today: '2026-08-07' })
		);
		expect(summary.trendKg).toBeNull();
		expect(summary.changes).toEqual([]);
		expect(summary.coverage.daysSinceLatest).toBeNull();
	});
});

describe('summarizeWeightForChat — milestones', () => {
	it('klipper til de sterkeste og sier at det er klippet', () => {
		const milestones = Array.from({ length: MAX_MILESTONES + 2 }, (_, i) => ({
			kind: 'record',
			sentence: `Milepæl ${i}`,
			tone: 'positiv',
			basis: 'trend'
		}));
		const summary = summarizeWeightForChat(input({ milestones }), 'milestones');
		expect(summary.milestones).toHaveLength(MAX_MILESTONES);
		expect(summary.truncated).toBe(true);
		expect(summary.milestones?.[0].sentence).toBe('Milepæl 0');
	});

	it('beholder basis og hull, som skiller en sterk setning fra en svak', () => {
		const summary = summarizeWeightForChat(
			input({
				milestones: [
					{
						kind: 'lowest_since',
						sentence: 'Laveste trend siden mars.',
						tone: 'positiv',
						basis: 'trend',
						sinceDate: '2026-03-02',
						longestGapDays: 12
					}
				]
			}),
			'milestones'
		);
		expect(summary.milestones?.[0]).toMatchObject({ basis: 'trend', sinceDate: '2026-03-02', longestGapDays: 12 });
	});
});

describe('summarizeWeightForChat — composition', () => {
	it('gir setningen og rådeltaene, ikke en utregnet prosent', () => {
		const summary = summarizeWeightForChat(
			input({
				composition: {
					windowDays: 84,
					fromDate: '2026-05-01',
					toDate: '2026-07-24',
					sentence: 'Ned 1,4 kg — −1,2 kg fett, −0,9 kg muskel',
					fatShare: 0.86,
					weightDeltaKg: -1.4,
					fatDeltaKg: -1.2,
					muscleDeltaKg: -0.9
				}
			}),
			'composition'
		);
		expect(summary.composition?.sentence).toContain('muskel');
		expect(summary.composition?.fatShare).toBe(0.86);
		expect(summary.missing).toBeUndefined();
	});

	it('sier hvorfor sammensetningen mangler', () => {
		const summary = summarizeWeightForChat(input(), 'composition');
		expect(summary.composition).toBeNull();
		expect(summary.missing).toContain('fettmåling');
	});
});

describe('summarizeWeightForChat — «vi har jo alle tallene»', () => {
	/**
	 * Regresjonen: på «snittvekt per måned tilbake til 2014» svarte chatten at den
	 * ikke hadde tilgang til månedsdata, og fant på åtte tall — for måneder som var
	 * tett målt. Begge halvdelene av feilen låses her.
	 */
	it('sier når historikken faktisk begynner', () => {
		// Uten dette må modellen regne seg fram fra historyDays for å vite om den har
		// noe — og en modell som må regne for å vite, svarer gjerne at den ikke har.
		const summary = summarizeWeightForChat(input({ historyStart: '2017-10-13' }));

		expect(summary.coverage.firstWeighIn).toBe('2017-10-13');
	});

	it('faller tilbake på første dag i serien når historyStart mangler', () => {
		const summary = summarizeWeightForChat(input());

		expect(summary.coverage.firstWeighIn).toBe(input().days[0].date);
	});

	it('gir en månedsserie framfor at modellen må finne på en', () => {
		const summary = summarizeWeightForChat(input(), 'monthly');

		expect(summary.months).toBeDefined();
		expect(summary.months!.length).toBeGreaterThan(0);
		expect(summary.measuredFrom).not.toBeNull();
	});

	it('merker hver månedsrad som målt eller anslått', () => {
		// Et interpolert og et målt tall ser like ut i et skjermbilde. Provenienser
		// er hele grunnen til at serien regnes her framfor av modellen.
		const summary = summarizeWeightForChat(input(), 'monthly');

		for (const month of summary.months!) {
			expect(['measured', 'interpolated'], month.month).toContain(month.source);
		}
	});

	it('teller tett målte måneder som målt, ikke som anslag', () => {
		// Kjernen i feilen: månedene modellen «interpolerte» var fulle av målinger.
		const summary = summarizeWeightForChat(input(), 'monthly');

		expect(summary.measuredMonths).toBeGreaterThan(0);
		expect(summary.months!.some((m) => m.source === 'measured' && m.days > 0)).toBe(true);
	});
});
