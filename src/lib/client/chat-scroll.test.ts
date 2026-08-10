import { describe, it, expect } from 'vitest';
import {
	isNearTop,
	scrollTopAfterPrepend,
	bottomAnchorKey,
	NEAR_TOP_PX
} from './chat-scroll';

describe('isNearTop', () => {
	it('er sann rett under terskelen og usann på den', () => {
		expect(isNearTop({ scrollTop: NEAR_TOP_PX - 1, scrollHeight: 2000 })).toBe(true);
		expect(isNearTop({ scrollTop: NEAR_TOP_PX, scrollHeight: 2000 })).toBe(false);
	});

	it('er sann på toppen', () => {
		expect(isNearTop({ scrollTop: 0, scrollHeight: 2000 })).toBe(true);
	});

	it('er usann langt nede', () => {
		expect(isNearTop({ scrollTop: 1500, scrollHeight: 2000 })).toBe(false);
	});

	it('godtar en egen terskel', () => {
		expect(isNearTop({ scrollTop: 300, scrollHeight: 2000 }, 400)).toBe(true);
	});
});

describe('scrollTopAfterPrepend', () => {
	it('flytter posisjonen ned like mye som innholdet vokste', () => {
		// 600 px lagt til på toppen: brukeren sto på 40, skal ende på 640.
		expect(scrollTopAfterPrepend({ scrollTop: 40, scrollHeight: 1000 }, 1600)).toBe(640);
	});

	it('holder utsnittet i ro også fra toppen', () => {
		expect(scrollTopAfterPrepend({ scrollTop: 0, scrollHeight: 1000 }, 1300)).toBe(300);
	});

	it('er en no-op når ingenting ble lagt til', () => {
		expect(scrollTopAfterPrepend({ scrollTop: 80, scrollHeight: 1000 }, 1000)).toBe(80);
	});
});

describe('bottomAnchorKey', () => {
	it('endres når en ny melding kommer til', () => {
		const før = bottomAnchorKey('a', 0, false);
		const etter = bottomAnchorKey('b', 0, false);
		expect(etter).not.toBe(før);
	});

	it('endres mens svaret strømmer', () => {
		expect(bottomAnchorKey('a', 12, true)).not.toBe(bottomAnchorKey('a', 4, true));
	});

	it('er UENDRET når eldre meldinger legges til på toppen', () => {
		// Dette er hele grunnen til at nøkkelen finnes: siste melding er den samme,
		// så visningen skal ikke rykke ned til bunnen.
		const førPrepend = bottomAnchorKey('siste', 0, false);
		const etterPrepend = bottomAnchorKey('siste', 0, false);
		expect(etterPrepend).toBe(førPrepend);
	});

	it('takler en tom tråd', () => {
		expect(bottomAnchorKey(undefined, 0, false)).toBe(':0:false');
	});
});
