import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CLOSE_TIME,
	DEFAULT_DIGEST_TIME_WEEKDAY,
	DEFAULT_DIGEST_TIME_WEEKEND,
	DEFAULT_PLANNING_TIME,
	DEFAULT_QUIET_END,
	DEFAULT_QUIET_START,
	DEFAULT_RELATIONSHIP_MORNING_TIME,
	NUDGE_WINDOW_MINUTES,
	digestTimeFor,
	isTimeInWindow,
	isWeekend,
	resolveNudgeMode
} from './nudge-schedule';
import { isWithinRecentMinutesWindow } from '$lib/server/nudge-time';

const AWAKE = { forceDigest: false };
/** 2026-09-04 er en fredag, 2026-09-05 en lørdag. */
const FRIDAY = '2026-09-04';
const SATURDAY = '2026-09-05';

describe('isTimeInWindow', () => {
	it('håndterer et vindu som krysser midnatt', () => {
		expect(isTimeInWindow('23:30', '22:00', '07:00')).toBe(true);
		expect(isTimeInWindow('03:00', '22:00', '07:00')).toBe(true);
		expect(isTimeInWindow('12:00', '22:00', '07:00')).toBe(false);
	});

	it('er halvåpent — slutten er utenfor', () => {
		expect(isTimeInWindow('22:00', '22:00', '07:00')).toBe(true);
		expect(isTimeInWindow('07:00', '22:00', '07:00')).toBe(false);
	});
});

describe('standardtidene mot standard stillevindu', () => {
	/**
	 * Regresjonen som gjorde to av fire grener strukturelt uoppnåelige.
	 *
	 * Med `20:00`–`08:00` som stillevindu lå både plan-dag (07:00) og
	 * avslutt-dag (21:00) INNI det, så `resolveNudgeMode` sendte dem til digest
	 * hver eneste gang og de interaktive pushene kunne aldri sendes. Ingenting
	 * feilet — det kom bare aldri noe varsel.
	 */
	it('ingen standardtid ligger i standard stillevindu', () => {
		for (const time of [
			DEFAULT_PLANNING_TIME,
			DEFAULT_CLOSE_TIME,
			DEFAULT_RELATIONSHIP_MORNING_TIME,
			DEFAULT_DIGEST_TIME_WEEKDAY,
			DEFAULT_DIGEST_TIME_WEEKEND
		]) {
			expect(
				isTimeInWindow(time, DEFAULT_QUIET_START, DEFAULT_QUIET_END),
				`${time} ligger i stillevinduet ${DEFAULT_QUIET_START}–${DEFAULT_QUIET_END}`
			).toBe(false);
		}
	});

	it('plan-dag og avslutt-dag er interaktive på en hverdag', () => {
		expect(resolveNudgeMode(undefined, FRIDAY, DEFAULT_PLANNING_TIME, AWAKE)).toBe('interactive');
		expect(resolveNudgeMode(undefined, FRIDAY, DEFAULT_CLOSE_TIME, AWAKE)).toBe('interactive');
	});
});

describe('resolveNudgeMode', () => {
	it('gir digest i helga', () => {
		expect(resolveNudgeMode(undefined, SATURDAY, '10:00', AWAKE)).toBe('digest');
	});

	it('gir digest om natta, uansett ukedag', () => {
		expect(resolveNudgeMode(undefined, FRIDAY, '03:00', AWAKE)).toBe('digest');
	});

	it('triagen slår alt', () => {
		expect(resolveNudgeMode(undefined, FRIDAY, '09:00', { forceDigest: true })).toBe('digest');
	});

	it('respekterer et avskrudd stillevindu', () => {
		const profile = { quietHours: { enabled: false } };
		expect(resolveNudgeMode(profile, FRIDAY, '03:00', AWAKE)).toBe('interactive');
	});
});

describe('digestTimeFor', () => {
	it('skiller helg fra hverdag', () => {
		expect(digestTimeFor(undefined, FRIDAY)).toBe(DEFAULT_DIGEST_TIME_WEEKDAY);
		expect(digestTimeFor(undefined, SATURDAY)).toBe(DEFAULT_DIGEST_TIME_WEEKEND);
	});

	it('lar brukeren overstyre', () => {
		expect(digestTimeFor({ digestTimeWeekend: '11:30' }, SATURDAY)).toBe('11:30');
	});
});

describe('isWeekend', () => {
	it('kjenner lørdag og søndag', () => {
		expect(isWeekend(SATURDAY)).toBe(true);
		expect(isWeekend('2026-09-06')).toBe(true);
		expect(isWeekend(FRIDAY)).toBe(false);
	});
});

describe('vinduet mot en timebasert cron', () => {
	/**
	 * Feilen som gjorde digesten stum i månedsvis: en eksakt sammenligning mot
	 * `10:00` bommer på et tikk som lander 10:07, og GitHub Actions' klokke
	 * gjorde nettopp det. Vinduet er derfor en time — like bredt som avstanden
	 * mellom to tikk.
	 */
	it('treffer et forsinket tikk', () => {
		expect(isWithinRecentMinutesWindow('10:07', '10:00', NUDGE_WINDOW_MINUTES)).toBe(true);
		expect(isWithinRecentMinutesWindow('10:54', '10:00', NUDGE_WINDOW_MINUTES)).toBe(true);
	});

	it('treffer et konfigurert klokkeslett mellom to tikk', () => {
		// Cron går på hel time; brukeren har valgt 07:30. Tikket 08:00 tar den.
		expect(isWithinRecentMinutesWindow('08:00', '07:30', NUDGE_WINDOW_MINUTES)).toBe(true);
		expect(isWithinRecentMinutesWindow('07:00', '07:30', NUDGE_WINDOW_MINUTES)).toBe(false);
	});

	it('slipper bare ett timetikk gjennom', () => {
		expect(isWithinRecentMinutesWindow('11:00', '10:00', NUDGE_WINDOW_MINUTES)).toBe(false);
	});
});
