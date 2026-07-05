import { describe, it, expect } from 'vitest';
import {
	buildFerieReadingSeries,
	formatMinutesLabel,
	formatPeriodLabel,
	type FerieBook
} from './ferie-reading';

function bok(overrides: Partial<FerieBook>): FerieBook {
	return {
		id: 'b1',
		themeId: 'tema-1',
		title: 'Sult',
		author: 'Knut Hamsun',
		coverUrl: null,
		format: 'print',
		totalPages: 200,
		totalMinutes: null,
		points: [],
		...overrides
	};
}

function pkt(loggedAt: string, page: number | null, minutes: number | null = null) {
	return { loggedAt, currentPage: page, currentMinutes: minutes };
}

const START = '2026-07-01';
const SLUTT = '2026-07-10';

describe('buildFerieReadingSeries', () => {
	it('bygger serie med baseline fra siste punkt før ferien', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-06-20T18:00:00Z', 30),
				pkt('2026-06-28T18:00:00Z', 50),
				pkt('2026-07-03T18:00:00Z', 110),
				pkt('2026-07-09T18:00:00Z', 180)
			] })],
			START, SLUTT
		);
		expect(serier).toHaveLength(1);
		const s = serier[0];
		// Baseline-punktet ligger på feriens første dag med verdien fra 28. juni.
		expect(s.points[0]).toMatchObject({ x: 0, date: START, value: 50 });
		expect(s.deltaLabel).toBe('130 sider');
		expect(s.fromPct).toBe(25);
		expect(s.toPct).toBe(90);
	});

	it('filtrerer bort bøker uten loggpunkter i vinduet', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [pkt('2026-06-20T18:00:00Z', 30)] })],
			START, SLUTT
		);
		expect(serier).toHaveLength(0);
	});

	it('filtrerer bort bøker uten økning i vinduet', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-06-28T18:00:00Z', 50),
				pkt('2026-07-03T18:00:00Z', 50) // slider rørt, men ingen fremgang
			] })],
			START, SLUTT
		);
		expect(serier).toHaveLength(0);
	});

	it('bok uten tidligere logg regnes som påbegynt i ferien (baseline 0)', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [pkt('2026-07-05T18:00:00Z', 80)] })],
			START, SLUTT
		);
		expect(serier).toHaveLength(1);
		expect(serier[0].points[0]).toMatchObject({ x: 0, value: 0 });
		expect(serier[0].deltaLabel).toBe('80 sider');
	});

	it('utleder lesestart og -slutt fra første og siste økning', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-06-28T18:00:00Z', 50),
				pkt('2026-07-02T18:00:00Z', 50), // ingen fremgang ennå
				pkt('2026-07-04T18:00:00Z', 90), // her startet lesingen
				pkt('2026-07-07T18:00:00Z', 140), // siste økning
				pkt('2026-07-09T18:00:00Z', 140)
			] })],
			START, SLUTT
		);
		expect(serier[0].periodLabel).toBe('4.–7. juli');
	});

	it('lydbok bruker minutter og formaterer delta som tid', () => {
		const serier = buildFerieReadingSeries(
			[bok({
				format: 'audio', totalPages: null, totalMinutes: 600,
				points: [
					pkt('2026-06-25T10:00:00Z', null, 60),
					pkt('2026-07-06T10:00:00Z', null, 260)
				]
			})],
			START, SLUTT
		);
		expect(serier[0].metric).toBe('minutter');
		expect(serier[0].deltaLabel).toBe('3t 20m');
		expect(serier[0].toPct).toBe(43);
	});

	it('normaliserer mot største observerte verdi når total mangler', () => {
		const serier = buildFerieReadingSeries(
			[bok({ totalPages: null, points: [
				pkt('2026-07-02T18:00:00Z', 50),
				pkt('2026-07-08T18:00:00Z', 100)
			] })],
			START, SLUTT
		);
		const s = serier[0];
		expect(s.fromPct).toBeNull();
		expect(s.toPct).toBeNull();
		expect(s.points[s.points.length - 1].y).toBe(1);
	});

	it('bruker siste snapshot per dag når slideren dras flere ganger', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-07-02T10:00:00Z', 60),
				pkt('2026-07-02T21:00:00Z', 75) // korrigert samme kveld
			] })],
			START, SLUTT
		);
		expect(serier[0].points.map((p) => p.value)).toEqual([0, 75]);
	});

	it('ignorerer loggpunkter etter ferieslutt', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-07-05T18:00:00Z', 80),
				pkt('2026-07-20T18:00:00Z', 200)
			] })],
			START, SLUTT
		);
		expect(serier[0].deltaLabel).toBe('80 sider');
	});

	it('sorterer mest lest (relativt) først', () => {
		const serier = buildFerieReadingSeries(
			[
				bok({ id: 'lite', title: 'Lite lest', points: [pkt('2026-07-05T18:00:00Z', 20)] }),
				bok({ id: 'mye', title: 'Mye lest', points: [pkt('2026-07-05T18:00:00Z', 180)] })
			],
			START, SLUTT
		);
		expect(serier.map((s) => s.bookId)).toEqual(['mye', 'lite']);
	});

	it('x-posisjoner spenner ferievinduet 0..1', () => {
		const serier = buildFerieReadingSeries(
			[bok({ points: [
				pkt('2026-07-01T18:00:00Z', 20),
				pkt('2026-07-10T18:00:00Z', 120)
			] })],
			START, SLUTT
		);
		const xs = serier[0].points.map((p) => p.x);
		expect(xs[0]).toBe(0);
		expect(xs[xs.length - 1]).toBe(1);
	});
});

describe('formatPeriodLabel', () => {
	it('samme måned kollapses', () => {
		expect(formatPeriodLabel('2026-07-02', '2026-07-09')).toBe('2.–9. juli');
	});
	it('ulike måneder skrives fullt ut', () => {
		expect(formatPeriodLabel('2026-06-28', '2026-07-03')).toBe('28. juni – 3. juli');
	});
	it('én dag gir én dato', () => {
		expect(formatPeriodLabel('2026-07-02', '2026-07-02')).toBe('2. juli');
	});
});

describe('formatMinutesLabel', () => {
	it('timer og minutter med nullpadding', () => {
		expect(formatMinutesLabel(185)).toBe('3t 05m');
	});
	it('under en time gir bare minutter', () => {
		expect(formatMinutesLabel(45)).toBe('45m');
	});
});
