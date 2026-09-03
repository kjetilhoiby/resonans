import { describe, it, expect } from 'vitest';
import {
	MIN_WEEKS_FOR_PATTERN,
	buildWeeklyIntensity,
	describeWeeklyIntensity,
	mondayOf,
	totalsFor,
	type SessionIntensity
} from './weekly-intensity';

/** Én økt med minutter oppgitt i minutter, for lesbarhet. */
function session(date: string, easy: number, grey: number, quality: number): SessionIntensity {
	return {
		date,
		easySeconds: easy * 60,
		greySeconds: grey * 60,
		qualitySeconds: quality * 60,
		measuredSeconds: (easy + grey + quality) * 60
	};
}

describe('mondayOf', () => {
	it('finner mandagen i uka', () => {
		// 2026-09-03 er en torsdag.
		expect(mondayOf('2026-09-03')).toBe('2026-08-31');
	});

	it('lar en mandag være seg selv', () => {
		expect(mondayOf('2026-08-31')).toBe('2026-08-31');
	});

	it('legger søndagen i uka som BEGYNTE, ikke i den som kommer', () => {
		// En søndagskveldsøkt hører til uka man har trent, ikke til neste.
		expect(mondayOf('2026-09-06')).toBe('2026-08-31');
	});

	it('krysser månedsskiftet', () => {
		expect(mondayOf('2026-10-01')).toBe('2026-09-28');
	});
});

describe('buildWeeklyIntensity', () => {
	it('summerer øktene i mandag-ankrede uker', () => {
		const weeks = buildWeeklyIntensity(
			[session('2026-08-31', 40, 5, 0), session('2026-09-02', 20, 4, 16)],
			{ today: '2026-09-03', weeks: 1 }
		);
		expect(weeks).toHaveLength(1);
		expect(weeks[0]).toMatchObject({
			weekStart: '2026-08-31',
			easyMinutes: 60,
			greyMinutes: 9,
			qualityMinutes: 16,
			totalMinutes: 85,
			sessions: 2
		});
	});

	it('tar med uker uten økter som nuller, ikke som hull', () => {
		// En uke man ikke trente er informasjon om treningen. Utelot vi den, ville
		// tolv bjelker dekket et halvår og aksen løyet om tempoet.
		const weeks = buildWeeklyIntensity([session('2026-09-02', 30, 5, 10)], {
			today: '2026-09-03',
			weeks: 3
		});
		expect(weeks.map((w) => w.weekStart)).toEqual([
			'2026-08-17',
			'2026-08-24',
			'2026-08-31'
		]);
		expect(weeks[0].totalMinutes).toBe(0);
		expect(weeks[0].sessions).toBe(0);
		expect(weeks[0].greyShare).toBeNull();
	});

	it('gir uker i stigende rekkefølge, med denne uka sist', () => {
		const weeks = buildWeeklyIntensity([], { today: '2026-09-03', weeks: 4 });
		expect(weeks.at(-1)!.weekStart).toBe(mondayOf('2026-09-03'));
		const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
		expect(weeks.map((w) => w.weekStart)).toEqual(sorted.map((w) => w.weekStart));
	});

	it('ignorerer økter utenfor vinduet i stillhet', () => {
		// Kalleren leser bredere enn grafen tegner, og det er meningen.
		const weeks = buildWeeklyIntensity(
			[session('2026-01-05', 60, 10, 20), session('2026-09-02', 30, 5, 10)],
			{ today: '2026-09-03', weeks: 2 }
		);
		expect(weeks.reduce((n, w) => n + w.totalMinutes, 0)).toBe(45);
	});

	it('regner grå-andelen av ukas egen total, ikke av vinduet', () => {
		const weeks = buildWeeklyIntensity([session('2026-09-02', 75, 25, 0)], {
			today: '2026-09-03',
			weeks: 1
		});
		expect(weeks[0].greyShare).toBeCloseTo(0.25, 5);
	});
});

describe('totalsFor', () => {
	it('deler kvalitetsminutter på AKTIVE uker, ikke på alle', () => {
		// To hvileuker ville ellers halvert snittet og fått treningen til å se
		// tynnere ut enn den var.
		const weeks = buildWeeklyIntensity(
			[session('2026-08-31', 60, 10, 20), session('2026-09-02', 40, 5, 20)],
			{ today: '2026-09-03', weeks: 4 }
		);
		const totals = totalsFor(weeks);
		expect(totals.weeks).toBe(4);
		expect(totals.activeWeeks).toBe(1);
		expect(totals.qualityMinutes).toBe(40);
		expect(totals.qualityPerActiveWeek).toBe(40);
	});

	it('gir null per uke uten aktive uker framfor å dele på null', () => {
		const totals = totalsFor(buildWeeklyIntensity([], { today: '2026-09-03', weeks: 4 }));
		expect(totals.qualityPerActiveWeek).toBeNull();
		expect(totals.greyShare).toBeNull();
	});

	it('lar totalen være summen av de tre delene', () => {
		const weeks = buildWeeklyIntensity([session('2026-09-02', 30, 7, 13)], {
			today: '2026-09-03',
			weeks: 2
		});
		const t = totalsFor(weeks);
		expect(t.totalMinutes).toBe(t.easyMinutes + t.greyMinutes + t.qualityMinutes);
	});
});

describe('describeWeeklyIntensity', () => {
	function totals(easy: number, grey: number, quality: number, activeWeeks: number) {
		const total = easy + grey + quality;
		return {
			easyMinutes: easy,
			greyMinutes: grey,
			qualityMinutes: quality,
			totalMinutes: total,
			weeks: 12,
			activeWeeks,
			greyShare: total > 0 ? grey / total : null,
			qualityPerActiveWeek: activeWeeks > 0 ? Math.round(quality / activeWeeks) : null
		};
	}

	it('oppgir alle tre mengdene i minutter', () => {
		const text = describeWeeklyIntensity(totals(600, 180, 90, 8));
		expect(text).toContain('600 min rolig');
		expect(text).toContain('90 min kvalitet');
		expect(text).toContain('180 min i midten');
	});

	it('sier kvalitetsminutter per uke', () => {
		expect(describeWeeklyIntensity(totals(600, 180, 96, 8))).toContain('12 kvalitetsminutter per uke');
	});

	it('holder tilbake tolkningen under fire aktive uker', () => {
		const text = describeWeeklyIntensity(totals(200, 50, 20, 2));
		expect(text).toContain('For få uker');
		expect(text).not.toContain('aldri null');
	});

	it('sier at grået aldri blir null framfor å anklage', () => {
		// En graf som anklager permanent er en graf man slutter å åpne.
		const text = describeWeeklyIntensity(totals(600, 300, 90, 8));
		expect(text).toContain('aldri null');
		expect(text).toContain('oppvarming');
	});

	it('oppgir INGEN grå-terskel — brukerens gulv er ukjent ennå', () => {
		// Regresjonsvakt: et gulv jeg fant på ville vært en dom uten grunnlag.
		for (const grey of [30, 180, 400]) {
			const text = describeWeeklyIntensity(totals(600, grey, 90, 8));
			expect(text).not.toMatch(/for høy|bør ned|under \d+\s?%/i);
		}
	});

	it('skiller «ingen økter» fra en uke uten kvalitet', () => {
		expect(describeWeeklyIntensity(totals(0, 0, 0, 0))).toContain('Ingen økter');
		expect(describeWeeklyIntensity(totals(600, 100, 0, 8))).toContain('0 min kvalitet');
	});

	it('bøyer «uke» riktig i entall', () => {
		expect(describeWeeklyIntensity(totals(200, 40, 10, 1))).toContain('1 uke med trening');
		expect(MIN_WEEKS_FOR_PATTERN).toBe(4);
	});
});
