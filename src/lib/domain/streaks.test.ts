import { describe, it, expect } from 'vitest';
import {
	computeStreak,
	streakLabel,
	streakSublabel,
	dueLabel,
	dayNumber,
	dayKeyFromNumber
} from './streaks';

// Faste datoer for forutsigbare tester. 2026-07-20 er en mandag,
// så uke-vinduene er 13.–19. juli, 20.–26. juli osv.
const MANDAG = '2026-07-20';
const LORDAG = '2026-07-25';

describe('dagsnøkler', () => {
	it('konverterer fram og tilbake', () => {
		expect(dayKeyFromNumber(dayNumber(LORDAG))).toBe(LORDAG);
	});

	it('regner ut differanse i dager på tvers av månedsskifte', () => {
		expect(dayNumber('2026-08-01') - dayNumber('2026-07-30')).toBe(2);
	});
});

describe('consecutive_days — dager på rad', () => {
	const def = { rule: 'consecutive_days' as const, config: {} };

	it('teller sammenhengende dager til og med i dag', () => {
		const state = computeStreak(def, ['2026-07-23', '2026-07-24', '2026-07-25'], LORDAG);
		expect(state.count).toBe(3);
		expect(state.unit).toBe('day');
		expect(state.status).toBe('ok');
		expect(state.lastEventDay).toBe('2026-07-25');
	});

	it('holder streaken i live når dagens økt mangler, men markerer den som forfallende', () => {
		const state = computeStreak(def, ['2026-07-23', '2026-07-24'], LORDAG);
		expect(state.count).toBe(2);
		expect(state.status).toBe('due_soon');
	});

	it('brytes av et hull', () => {
		const state = computeStreak(def, ['2026-07-22', '2026-07-24', '2026-07-25'], LORDAG);
		expect(state.count).toBe(2);
	});

	it('nullstilles når siste økt er for gammel, men husker beste rekke', () => {
		const state = computeStreak(def, ['2026-07-20', '2026-07-21'], LORDAG);
		expect(state.count).toBe(0);
		expect(state.status).toBe('idle');
		expect(state.bestCount).toBe(2);
	});

	it('teller to økter samme dag som én dag', () => {
		const state = computeStreak(def, ['2026-07-25', '2026-07-25'], LORDAG);
		expect(state.count).toBe(1);
	});

	it('gir tom tilstand uten hendelser', () => {
		const state = computeStreak(def, [], LORDAG);
		expect(state).toMatchObject({ count: 0, status: 'idle', bestCount: 0, lastEventDay: null });
		expect(state.dots).toHaveLength(7);
	});

	it('gir sju prikker som ender på i dag', () => {
		const state = computeStreak(def, ['2026-07-24', '2026-07-25'], LORDAG);
		expect(state.dots).toEqual([false, false, false, false, false, true, true]);
	});
});

describe('consecutive_days — toleranse for korte pauser', () => {
	const tolerant = {
		rule: 'consecutive_days' as const,
		config: { maxGapDays: 2, maxGaps: 1 }
	};

	it('holder rekka gjennom to feriedager når økta er tatt opp igjen', () => {
		// Løp 20.–22., to tunge dager på ferie (23.–24.), i gang igjen 25.
		const state = computeStreak(
			tolerant,
			['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-25'],
			LORDAG
		);
		expect(state.count).toBe(4);
		expect(state.gapCount).toBe(1);
		expect(state.gapUnits).toBe(2);
		expect(state.status).toBe('ok');
	});

	it('gjenoppretter en rekke som var brutt, uten at noe må gjøres', () => {
		// Samme pause, men dagens økt er ikke tatt ennå. Uten toleranse ville dette
		// vært 0 — med toleranse lever rekka videre, retroaktivt.
		const events = ['2026-07-20', '2026-07-21', '2026-07-22'];
		expect(computeStreak({ rule: 'consecutive_days', config: {} }, events, LORDAG).count).toBe(0);

		const state = computeStreak(tolerant, events, LORDAG);
		expect(state.count).toBe(3);
		expect(state.gapCount).toBe(1);
		expect(state.gapUnits).toBe(2);
		expect(state.status).toBe('due_soon');
	});

	it('bryter når pausen er lengre enn tolerert', () => {
		// Tre dager uten økt (22.–24.) med toleranse for to.
		const state = computeStreak(tolerant, ['2026-07-20', '2026-07-21', '2026-07-25'], LORDAG);
		expect(state.count).toBe(1);
		expect(state.gapCount).toBe(0);
	});

	it('tolererer bare så mange pauser som budsjettet tillater', () => {
		const events = ['2026-07-21', '2026-07-23', '2026-07-25'];
		const one = computeStreak(
			{ rule: 'consecutive_days', config: { maxGapDays: 1, maxGaps: 1 } },
			events,
			LORDAG
		);
		expect(one.count).toBe(2);
		expect(one.gapCount).toBe(1);

		const two = computeStreak(
			{ rule: 'consecutive_days', config: { maxGapDays: 1, maxGaps: 2 } },
			events,
			LORDAG
		);
		expect(two.count).toBe(3);
		expect(two.gapCount).toBe(2);
		expect(two.gapUnits).toBe(2);
	});

	it('gir én pause som standard når maxGapDays er satt alene', () => {
		const state = computeStreak(
			{ rule: 'consecutive_days', config: { maxGapDays: 1 } },
			['2026-07-21', '2026-07-23', '2026-07-25'],
			LORDAG
		);
		expect(state.gapCount).toBe(1);
		expect(state.count).toBe(2);
	});

	it('teller ingen pause når rekka er ubrutt', () => {
		const state = computeStreak(tolerant, ['2026-07-24', '2026-07-25'], LORDAG);
		expect(state.count).toBe(2);
		expect(state.gapCount).toBe(0);
		expect(state.gapUnits).toBe(0);
	});

	it('er uendret fra streng telling uten toleranse', () => {
		const events = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-25'];
		const strict = computeStreak({ rule: 'consecutive_days', config: {} }, events, LORDAG);
		expect(strict.count).toBe(1);
		expect(strict.gapCount).toBe(0);
	});
});

describe('count_per_window — toleranse for en periode under terskel', () => {
	it('hopper over én uke under terskel og teller videre', () => {
		// Uke 20.–26.: to turer. Uke 13.–19.: bare én (under terskel).
		// Uke 6.–12.: to turer.
		const state = computeStreak(
			{
				rule: 'count_per_window',
				config: { windowDays: 7, threshold: 2, maxGapDays: 1, maxGaps: 1 }
			},
			['2026-07-07', '2026-07-09', '2026-07-14', '2026-07-21', '2026-07-23'],
			LORDAG
		);
		expect(state.count).toBe(2);
		expect(state.gapCount).toBe(1);
		expect(state.gapUnits).toBe(1);
		expect(streakLabel(state)).toBe('2 uker på rad (1 pause, 1 uke)');
	});
});

describe('count_per_window — perioder på rad over en terskel', () => {
	const def = { rule: 'count_per_window' as const, config: { windowDays: 7, threshold: 2 } };

	it('teller uker der terskelen er nådd', () => {
		const state = computeStreak(
			def,
			['2026-07-14', '2026-07-16', '2026-07-21', '2026-07-23'],
			LORDAG
		);
		expect(state.count).toBe(2);
		expect(state.unit).toBe('week');
		expect(state.status).toBe('ok');
		expect(state.windowCount).toBe(2);
		expect(state.windowTarget).toBe(2);
	});

	it('lar en uke i arbeid stå uten å bryte streaken', () => {
		const state = computeStreak(
			def,
			['2026-07-07', '2026-07-09', '2026-07-14', '2026-07-16', '2026-07-21'],
			LORDAG
		);
		expect(state.count).toBe(2);
		expect(state.windowCount).toBe(1);
		expect(state.status).toBe('due_soon');
	});

	it('teller to hendelser samme dag som to mot terskelen', () => {
		const state = computeStreak(def, ['2026-07-21', '2026-07-21'], LORDAG);
		expect(state.windowCount).toBe(2);
		expect(state.count).toBe(1);
		expect(state.status).toBe('ok');
	});

	it('grupperer etter kalenderuke, ikke rullerende vindu', () => {
		// Søndag 19. og mandag 20. ligger i hver sin uke — ingen av dem når terskel 2.
		const state = computeStreak(def, ['2026-07-19', '2026-07-20'], LORDAG);
		expect(state.windowCount).toBe(1);
		expect(state.count).toBe(0);
	});

	it('brytes av en uke under terskelen', () => {
		const state = computeStreak(
			def,
			['2026-07-07', '2026-07-09', '2026-07-16', '2026-07-21', '2026-07-23'],
			LORDAG
		);
		expect(state.count).toBe(1);
		expect(state.bestCount).toBe(1);
	});

	it('støtter andre periodelengder enn uke', () => {
		const state = computeStreak(
			{ rule: 'count_per_window', config: { windowDays: 14, threshold: 1 } },
			['2026-07-21'],
			LORDAG
		);
		expect(state.unit).toBe('round');
		expect(state.count).toBe(1);
	});

	it('gir tom tilstand uten hendelser, men beholder terskelen', () => {
		const state = computeStreak(def, [], LORDAG);
		expect(state).toMatchObject({ count: 0, status: 'idle', windowCount: 0, windowTarget: 2 });
	});
});

describe('max_interval — runder på rad innen et intervall', () => {
	const def = { rule: 'max_interval' as const, config: { intervalDays: 5 } };

	it('teller runder der hvert gap holdt intervallet', () => {
		const state = computeStreak(def, ['2026-07-01', '2026-07-05', '2026-07-10'], '2026-07-12');
		expect(state.count).toBe(3);
		expect(state.unit).toBe('round');
		expect(state.status).toBe('ok');
		expect(state.nextDueDay).toBe('2026-07-15');
		expect(state.daysUntilDue).toBe(3);
	});

	it('varsler som forfallende rett før fristen', () => {
		const state = computeStreak(def, ['2026-07-01', '2026-07-05', '2026-07-10'], '2026-07-14');
		expect(state.daysUntilDue).toBe(1);
		expect(state.status).toBe('due_soon');
		expect(state.count).toBe(3);
	});

	it('brytes når fristen er passert, men husker beste rekke', () => {
		const state = computeStreak(def, ['2026-07-01', '2026-07-05', '2026-07-10'], '2026-07-16');
		expect(state.status).toBe('overdue');
		expect(state.count).toBe(0);
		expect(state.bestCount).toBe(3);
		expect(state.daysUntilDue).toBe(-1);
	});

	it('teller bare runder etter siste for store gap', () => {
		const state = computeStreak(def, ['2026-07-01', '2026-07-10'], '2026-07-12');
		expect(state.count).toBe(1);
	});

	it('teller to runder samme dag som én', () => {
		const state = computeStreak(def, ['2026-07-10', '2026-07-10'], '2026-07-12');
		expect(state.count).toBe(1);
	});

	it('lar dueSoonDays overstyres', () => {
		const state = computeStreak(
			{ rule: 'max_interval', config: { intervalDays: 14, dueSoonDays: 7 } },
			['2026-07-10'],
			'2026-07-18'
		);
		expect(state.daysUntilDue).toBe(6);
		expect(state.status).toBe('due_soon');
	});

	it('bruker et lengre varsel-vindu for lange intervaller som standard', () => {
		// intervalDays 14 → dueSoonDays 5
		const ok = computeStreak(
			{ rule: 'max_interval', config: { intervalDays: 14 } },
			['2026-07-10'],
			'2026-07-18'
		);
		expect(ok.status).toBe('ok');
		const soon = computeStreak(
			{ rule: 'max_interval', config: { intervalDays: 14 } },
			['2026-07-10'],
			'2026-07-20'
		);
		expect(soon.status).toBe('due_soon');
	});

	it('gir tom tilstand uten hendelser', () => {
		const state = computeStreak(def, [], LORDAG);
		expect(state).toMatchObject({ count: 0, status: 'idle', nextDueDay: null, daysUntilDue: null });
	});

	it('markerer brutte gap i prikkene', () => {
		const state = computeStreak(def, ['2026-07-01', '2026-07-10', '2026-07-14'], '2026-07-15');
		expect(state.dots).toEqual([true, false, true]);
	});
});

describe('streakLabel', () => {
	it('bøyer enhetene riktig', () => {
		expect(streakLabel({ count: 1, unit: 'day' })).toBe('1 dag på rad');
		expect(streakLabel({ count: 6, unit: 'day' })).toBe('6 dager på rad');
		expect(streakLabel({ count: 1, unit: 'week' })).toBe('1 uke på rad');
		expect(streakLabel({ count: 3, unit: 'week' })).toBe('3 uker på rad');
		expect(streakLabel({ count: 5, unit: 'round' })).toBe('5 runder på rad');
	});

	it('er tom når streaken er brutt', () => {
		expect(streakLabel({ count: 0, unit: 'day' })).toBe('');
	});

	it('sier rett ut at rekka er holdt gjennom en pause', () => {
		expect(streakLabel({ count: 14, unit: 'day', gapCount: 1, gapUnits: 2 })).toBe(
			'14 dager på rad (1 pause, 2 dager)'
		);
		expect(streakLabel({ count: 9, unit: 'day', gapCount: 2, gapUnits: 3 })).toBe(
			'9 dager på rad (2 pauser, 3 dager)'
		);
		expect(streakLabel({ count: 5, unit: 'day', gapCount: 1, gapUnits: 1 })).toBe(
			'5 dager på rad (1 pause, 1 dag)'
		);
	});

	it('nevner ingen pause når det ikke er noen', () => {
		expect(streakLabel({ count: 6, unit: 'day', gapCount: 0, gapUnits: 0 })).toBe(
			'6 dager på rad'
		);
	});
});

describe('streakSublabel', () => {
	it('viser forfall for periodisk vedlikehold', () => {
		const state = computeStreak(
			{ rule: 'max_interval', config: { intervalDays: 5 } },
			['2026-07-10'],
			'2026-07-14'
		);
		expect(streakSublabel(state)).toBe('forfaller i morgen');
	});

	it('viser framdrift mot ukesterskelen', () => {
		const state = computeStreak(
			{ rule: 'count_per_window', config: { windowDays: 7, threshold: 2 } },
			['2026-07-21'],
			LORDAG
		);
		expect(streakSublabel(state)).toBe('1/2 denne uka');
	});

	it('sier «denne perioden» for andre periodelengder', () => {
		const state = computeStreak(
			{ rule: 'count_per_window', config: { windowDays: 14, threshold: 3 } },
			['2026-07-21'],
			LORDAG
		);
		expect(streakSublabel(state)).toBe('1/3 denne perioden');
	});

	it('minner om dagens økt når vane-streaken mangler i dag', () => {
		const state = computeStreak(
			{ rule: 'consecutive_days', config: {} },
			['2026-07-23', '2026-07-24'],
			LORDAG
		);
		expect(streakSublabel(state)).toBe('gjenstår i dag');
	});

	it('er null når alt er i rute', () => {
		const state = computeStreak({ rule: 'consecutive_days', config: {} }, [LORDAG], LORDAG);
		expect(streakSublabel(state)).toBeNull();
	});

	it('sier «ikke startet» uten hendelser', () => {
		const state = computeStreak({ rule: 'consecutive_days', config: {} }, [], LORDAG);
		expect(streakSublabel(state)).toBe('ikke startet');
	});
});

describe('dueLabel', () => {
	it('beskriver forfall i naturlig språk', () => {
		expect(dueLabel({ daysUntilDue: 0 })).toBe('forfaller i dag');
		expect(dueLabel({ daysUntilDue: 1 })).toBe('forfaller i morgen');
		expect(dueLabel({ daysUntilDue: 4 })).toBe('forfaller om 4 dager');
		expect(dueLabel({ daysUntilDue: -1 })).toBe('1 dag på overtid');
		expect(dueLabel({ daysUntilDue: -3 })).toBe('3 dager på overtid');
	});

	it('er null for regler uten forfall', () => {
		expect(dueLabel({ daysUntilDue: null })).toBeNull();
	});
});

/* ── Unnskyldte dager (sykdom) ───────────────────────────────────────────── */

describe('computeStreak — unnskyldte dager', () => {
	const daily = { rule: 'consecutive_days' as const, config: {} };

	it('sykedager bryter ikke rekka, og telleren står stille', () => {
		// Løp 1.–3. sep, syk 4.–6., løp igjen 7. Uten unnskyldning er dette
		// «1 dag på rad»; med unnskyldning er det fortsatt de fire dagene man løp.
		const events = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-07'];
		const sick = ['2026-09-04', '2026-09-05', '2026-09-06'];

		expect(computeStreak(daily, events, '2026-09-07').count).toBe(1);

		const state = computeStreak(daily, events, '2026-09-07', sick);
		expect(state.count).toBe(4);
		expect(state.excusedUnits).toBe(3);
	});

	it('sykedager bruker ikke av maxGapDays-toleransen', () => {
		// Toleransen skal fortsatt være der til en glemt dag SENERE.
		const def = { rule: 'consecutive_days' as const, config: { maxGapDays: 1, maxGaps: 1 } };
		const events = ['2026-09-01', '2026-09-02', '2026-09-06', '2026-09-07'];
		const sick = ['2026-09-03', '2026-09-04'];
		// 5. sep er en glemt dag, ikke en sykedag — den skal koste pausen.
		const state = computeStreak(def, events, '2026-09-07', sick);
		expect(state.count).toBe(4);
		expect(state.gapCount).toBe(1);
		expect(state.gapUnits).toBe(1);
		expect(state.excusedUnits).toBe(2);
	});

	it('en økt tatt mens man var syk teller som holdt, ikke som unnskyldt', () => {
		// Unnskyldningen fjerner kravet, ikke kreditten.
		const events = ['2026-09-01', '2026-09-02', '2026-09-03'];
		const state = computeStreak(daily, events, '2026-09-03', ['2026-09-02']);
		expect(state.count).toBe(3);
		expect(state.excusedUnits).toBe(0);
		expect(state.excusedDots[6]).toBe(false);
	});

	it('syk i dag krever ingenting — status er ok, ikke «gjenstår i dag»', () => {
		const events = ['2026-09-01', '2026-09-02'];
		expect(computeStreak(daily, events, '2026-09-03').status).toBe('due_soon');
		expect(computeStreak(daily, events, '2026-09-03', ['2026-09-03']).status).toBe('ok');
	});

	it('sykdom helt fram til i dag holder rekka i live', () => {
		const events = ['2026-09-01', '2026-09-02'];
		const sick = ['2026-09-03', '2026-09-04', '2026-09-05'];
		const state = computeStreak(daily, events, '2026-09-05', sick);
		expect(state.count).toBe(2);
		expect(state.status).toBe('ok');
	});

	it('bestCount senkes ikke av en sykeperiode', () => {
		const events = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-07'];
		const sick = ['2026-09-04', '2026-09-05', '2026-09-06'];
		expect(computeStreak(daily, events, '2026-09-20', sick).bestCount).toBe(4);
	});

	it('streakLabel sier hvor mange dager som var syke', () => {
		const events = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-07'];
		const sick = ['2026-09-04', '2026-09-05', '2026-09-06'];
		expect(streakLabel(computeStreak(daily, events, '2026-09-07', sick))).toBe(
			'4 dager på rad (3 dager syk)'
		);
	});
});

describe('computeStreak — sykedager i ukesregler', () => {
	// «Minst 2 løpeturer i uka», mandagsankrede uker.
	const weekly = { rule: 'count_per_window' as const, config: { windowDays: 7, threshold: 2 } };

	it('én sykedag senker ikke kravet', () => {
		const state = computeStreak(weekly, [], '2026-09-02', ['2026-09-01']);
		expect(state.windowTarget).toBe(2);
	});

	it('to sykedager halverer kravet', () => {
		const state = computeStreak(weekly, [], '2026-09-02', ['2026-09-01', '2026-09-02']);
		expect(state.windowTarget).toBe(1);
	});

	it('ei uke i senga er gjennomsiktig — verken holdt eller brutt', () => {
		// Uke 36 (31. aug–6. sep) holdt med to turer, uke 37 var syk hele veien,
		// uke 38 holdt igjen. Rekka skal være tre uker, ikke én.
		const events = [
			'2026-08-31', '2026-09-01', // uke 36
			'2026-09-14', '2026-09-15'  // uke 38
		];
		const sickWeek = [
			'2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
			'2026-09-11', '2026-09-12', '2026-09-13'
		];
		expect(computeStreak(weekly, events, '2026-09-15').count).toBe(1);
		const state = computeStreak(weekly, events, '2026-09-15', sickWeek);
		expect(state.count).toBe(2);
		expect(state.excusedUnits).toBe(1);
	});

	it('nådde du kravet i en unnskyldt uke, teller den som holdt', () => {
		const events = ['2026-09-07', '2026-09-08'];
		const sickWeek = [
			'2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
			'2026-09-11', '2026-09-12', '2026-09-13'
		];
		const state = computeStreak(weekly, events, '2026-09-13', sickWeek);
		expect(state.windowCount).toBe(2);
		expect(state.count).toBe(1);
	});
});

describe('computeStreak — sykedager i max_interval', () => {
	// Badevask hver 14. dag.
	const upkeep = { rule: 'max_interval' as const, config: { intervalDays: 14 } };

	it('sykedagene skyver fristen', () => {
		const state = computeStreak(upkeep, ['2026-09-01'], '2026-09-10', [
			'2026-09-05', '2026-09-06', '2026-09-07'
		]);
		expect(state.nextDueDay).toBe('2026-09-18');
		expect(state.daysUntilDue).toBe(8);
		expect(state.excusedUnits).toBe(3);
	});

	it('en runde som forfalt under sykdom bryter ikke rekka', () => {
		// 15. aug → 31. aug er 16 dager, altså to over intervallet. Tre sykedager
		// i det gapet gjør det tillatt.
		const rounds = ['2026-08-01', '2026-08-15', '2026-08-31'];
		expect(computeStreak(upkeep, rounds, '2026-08-31').count).toBe(1);
		const sick = ['2026-08-29', '2026-08-30', '2026-08-31'];
		expect(computeStreak(upkeep, rounds, '2026-08-31', sick).count).toBe(3);
	});

	it('sublabel forklarer hvorfor fristen flyttet seg', () => {
		const state = computeStreak(upkeep, ['2026-09-01'], '2026-09-10', ['2026-09-05']);
		// 1. sep + 14 dager = 15. sep, pluss én sykedag = 16. sep.
		expect(streakSublabel(state)).toBe('forfaller om 6 dager (1 sykedag lagt til)');
	});
});
