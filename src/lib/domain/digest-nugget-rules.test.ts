import { describe, expect, it } from 'vitest';
import {
	buildDigestPush,
	carryoverNugget,
	digestNuggets,
	loadHighNugget,
	streakDueNugget,
	weekChangeNugget,
	weekLoadNugget,
	type DigestStreak,
	type DigestWeek
} from './digest-nugget-rules';
import type { WeightDay } from './health/weight-series';
import type { StreakState } from './streaks';

function day(date: string, weightKg: number): WeightDay {
	return {
		date,
		weightKg,
		weighInCount: 1,
		fatMassKg: null,
		fatRatio: null,
		muscleMassKg: null,
		fatFreeMassKg: null
	};
}

/** En sammenhengende serie som faller `perDay` kg om dagen fra `start`. */
function series(from: string, days: number, start: number, perDay: number): WeightDay[] {
	const out: WeightDay[] = [];
	const base = Date.parse(`${from}T00:00:00Z`);
	for (let i = 0; i < days; i++) {
		const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
		out.push(day(date, Math.round((start + i * perDay) * 100) / 100));
	}
	return out;
}

function streak(over: Partial<StreakState> = {}): StreakState {
	return {
		count: 6,
		unit: 'day',
		bestCount: 12,
		lastEventDay: '2026-09-04',
		dots: [],
		excusedDots: [],
		status: 'due_soon',
		windowCount: null,
		windowTarget: null,
		nextDueDay: '2026-09-05',
		daysUntilDue: 0,
		gapCount: 0,
		gapUnits: 0,
		excusedUnits: 0,
		...over
	};
}

const WEEK_UNDER: DigestWeek = {
	planText: 'Under ukas plan (235–282) — det er rom igjen.',
	planLabel: 'Under ukas plan',
	loadText: 'Siste 3 dager ligger 0,72× av snittet siste 30 — godt uthvilt.',
	loadLevel: 'rolig'
};

const WEEK_HIGH: DigestWeek = {
	planText: 'Over ukas plan (235–282) — planen er et budsjett, ikke en grense.',
	planLabel: 'Over ukas plan',
	loadText: 'Siste 3 dager ligger 1,64× over snittet siste 30 — ta en rolig dag.',
	loadLevel: 'høy'
};

describe('streakDueNugget', () => {
	it('bruker rekkas egne ord fra streakLabel og dueLabel', () => {
		const nugget = streakDueNugget([{ title: 'Løping', state: streak() }]);
		expect(nugget).toEqual({
			kind: 'streak-due',
			headline: 'Løping forfaller i dag',
			sentence: 'Løping: 6 dager på rad. Rekka forfaller i dag.'
		});
	});

	it('tier om en rekke som er brutt — en anklage kan ikke handles på', () => {
		const overdue = streak({ status: 'overdue', daysUntilDue: -3 });
		expect(streakDueNugget([{ title: 'Løping', state: overdue }])).toBeNull();
	});

	it('tier om en frist som ligger for langt fram', () => {
		const later = streak({ daysUntilDue: 4 });
		expect(streakDueNugget([{ title: 'Løping', state: later }])).toBeNull();
	});

	it('tier om en rekke som ikke har begynt', () => {
		const idle = streak({ count: 0, status: 'idle' });
		expect(streakDueNugget([{ title: 'Løping', state: idle }])).toBeNull();
	});

	it('velger nærmeste frist, og lengste rekke ved likhet', () => {
		const candidates: DigestStreak[] = [
			{ title: 'Yoga', state: streak({ daysUntilDue: 1, count: 20 }) },
			{ title: 'Løping', state: streak({ daysUntilDue: 0, count: 3 }) },
			{ title: 'Styrke', state: streak({ daysUntilDue: 0, count: 9 }) }
		];
		expect(streakDueNugget(candidates)?.headline).toBe('Styrke forfaller i dag');
	});
});

describe('loadHighNugget', () => {
	it('sier fra bare når belastningen er høy', () => {
		expect(loadHighNugget(WEEK_HIGH)).toEqual({
			kind: 'load-high',
			headline: 'Høy belastning',
			sentence: WEEK_HIGH.loadText
		});
	});

	it('tier ved rolig og normal — de er sanne hver dag', () => {
		expect(loadHighNugget(WEEK_UNDER)).toBeNull();
		expect(loadHighNugget({ ...WEEK_UNDER, loadLevel: 'normal' })).toBeNull();
	});

	it('tier uten treningsløp', () => {
		expect(loadHighNugget(null)).toBeNull();
	});
});

describe('weekLoadNugget', () => {
	it('gjenbruker budsjettsetningen ordrett', () => {
		expect(weekLoadNugget(WEEK_UNDER)).toEqual({
			kind: 'week-load',
			headline: 'Under ukas plan',
			sentence: WEEK_UNDER.planText
		});
	});
});

describe('carryoverNugget', () => {
	it('navngir punktet framfor å telle det', () => {
		expect(carryoverNugget(['Bytt dekk'])).toEqual({
			kind: 'carryover',
			headline: 'Bytt dekk står igjen',
			sentence: 'Bytt dekk står igjen fra i går.'
		});
	});

	it('lister flere, med tallet i setningen', () => {
		const nugget = carryoverNugget(['Bytt dekk', 'Ring rørlegger', 'Rydd bod']);
		expect(nugget?.headline).toBe('Bytt dekk + 2 til står igjen');
		expect(nugget?.sentence).toBe(
			'3 punkter står igjen fra i går: Bytt dekk, Ring rørlegger, Rydd bod.'
		);
	});

	it('kapper lista, men teller alle', () => {
		const nugget = carryoverNugget(['A', 'B', 'C', 'D', 'E']);
		expect(nugget?.sentence).toBe('5 punkter står igjen fra i går: A, B, C, og 2 til.');
	});

	it('tier når ingenting står igjen', () => {
		expect(carryoverNugget([])).toBeNull();
		expect(carryoverNugget(['  '])).toBeNull();
	});
});

describe('weekChangeNugget', () => {
	it('måler trend mot trend sju dager tilbake', () => {
		// 21 dager med jevnt fall på 0,1 kg/dag ⇒ trenden faller 0,7 kg på ei uke.
		const days = series('2026-08-16', 21, 96, -0.1);
		const nugget = weekChangeNugget(days, '2026-09-05');
		expect(nugget?.kind).toBe('week-change');
		expect(nugget?.headline).toBe('Uka ble ned 0,7 kg');
		expect(nugget?.sentence).toContain('målt over 7 veiinger');
	});

	it('sier uendret under støygulvet framfor å tegne et stup', () => {
		const days = series('2026-08-16', 21, 96, -0.01);
		expect(weekChangeNugget(days, '2026-09-05')?.headline).toBe('Uka endte uendret på vekta');
	});

	it('tier når uka har for få veiinger til å være en uke', () => {
		const sparse = [day('2026-09-01', 96), day('2026-09-04', 95.6)];
		expect(weekChangeNugget(sparse, '2026-09-05')).toBeNull();
	});

	it('tier når historikken ikke rekker til et anker sju dager tilbake', () => {
		const days = series('2026-09-01', 5, 96, -0.1);
		expect(weekChangeNugget(days, '2026-09-05')).toBeNull();
	});
});

describe('digestNuggets', () => {
	const base = {
		today: '2026-09-05',
		sick: false,
		streaks: [] as DigestStreak[],
		carryover: [] as string[],
		weightDays: [] as WeightDay[],
		week: null as DigestWeek | null
	};

	it('rangerer det som fyrer én gang over det som er sant hver dag', () => {
		const kinds = digestNuggets({
			...base,
			streaks: [{ title: 'Løping', state: streak() }],
			carryover: ['Bytt dekk'],
			weightDays: series('2026-08-16', 21, 96, -0.1),
			week: WEEK_HIGH
		}).map((n) => n.kind);

		expect(kinds).toEqual(['streak-due', 'load-high', 'carryover', 'week-change', 'week-load']);
	});
});

describe('buildDigestPush', () => {
	const base = {
		today: '2026-09-05',
		sick: false,
		streaks: [] as DigestStreak[],
		carryover: [] as string[],
		weightDays: [] as WeightDay[],
		week: null as DigestWeek | null
	};

	it('sender ingenting når ingen regel har noe å si', () => {
		expect(buildDigestPush(base)).toBeNull();
	});

	it('sender ingenting i en sykeperiode', () => {
		const push = buildDigestPush({
			...base,
			sick: true,
			streaks: [{ title: 'Løping', state: streak() }],
			week: WEEK_HIGH
		});
		expect(push).toBeNull();
	});

	it('setter krydderet i tittelen og setningen under', () => {
		const push = buildDigestPush({ ...base, carryover: ['Bytt dekk'] });
		expect(push?.title).toBe('Bytt dekk står igjen');
		expect(push?.body).toBe('Bytt dekk står igjen fra i går.');
		expect(push?.secondary).toBeNull();
	});

	it('legger en annen sak i andrelinja', () => {
		const push = buildDigestPush({
			...base,
			streaks: [{ title: 'Løping', state: streak() }],
			carryover: ['Bytt dekk']
		});
		expect(push?.title).toBe('Løping forfaller i dag');
		expect(push?.body).toBe('Løping: 6 dager på rad. Rekka forfaller i dag. · Bytt dekk står igjen');
	});

	it('lar ikke budsjettet gjenta belastningen', () => {
		const push = buildDigestPush({ ...base, week: WEEK_HIGH });
		expect(push?.title).toBe('Høy belastning');
		expect(push?.secondary).toBeNull();
	});

	it('holder rekkefrist og høy belastning fra hverandre — begge er sanne', () => {
		const push = buildDigestPush({
			...base,
			streaks: [{ title: 'Løping', state: streak() }],
			week: WEEK_HIGH
		});
		expect(push?.title).toBe('Løping forfaller i dag');
		expect(push?.secondary?.kind).toBe('load-high');
	});

	it('faller tilbake på budsjettet når det er alt vi har', () => {
		const push = buildDigestPush({ ...base, week: WEEK_UNDER });
		expect(push?.title).toBe('Under ukas plan');
		expect(push?.body).toBe(WEEK_UNDER.planText);
	});
});
