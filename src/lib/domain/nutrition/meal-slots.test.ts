import { describe, it, expect } from 'vitest';
import {
	isMealSlotId,
	mealSlotForTime,
	mealSlotMeta,
	MEAL_SLOT_IDS,
	MEAL_SLOTS,
	reslotAfterTimeChange
} from './meal-slots';

/** Osloklokka → UTC-ISO. Sommertid er UTC+2, så 11:00 norsk er 09:00Z. */
function osloSummer(hhmm: string): string {
	const [h, m] = hhmm.split(':').map(Number);
	const utc = (h - 2 + 24) % 24;
	// Datoen ruller bakover når norsk tid er 00 eller 01.
	const day = h - 2 < 0 ? '02' : '03';
	return `2026-08-${day}T${String(utc).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
}

describe('MEAL_SLOTS', () => {
	it('er Lifesum-settet, i dagens rekkefølge med snacks sist', () => {
		expect(MEAL_SLOTS.map((s) => s.id)).toEqual(['frokost', 'lunsj', 'middag', 'kvelds', 'snacks']);
	});

	it('har samme innhold som MEAL_SLOT_IDS', () => {
		expect(MEAL_SLOTS.map((s) => s.id)).toEqual([...MEAL_SLOT_IDS]);
	});

	it('har label og emoji på alle', () => {
		for (const slot of MEAL_SLOTS) {
			expect(slot.label.length, slot.id).toBeGreaterThan(0);
			expect(slot.emoji.length, slot.id).toBeGreaterThan(0);
		}
	});
});

describe('mealSlotMeta', () => {
	it('slår opp på id', () => {
		expect(mealSlotMeta('kvelds').label).toBe('Kvelds');
		expect(mealSlotMeta('snacks').emoji).toBe('🍫');
	});
});

describe('isMealSlotId', () => {
	it('godtar bare de fem', () => {
		expect(isMealSlotId('frokost')).toBe(true);
		expect(isMealSlotId('snacks')).toBe(true);
		expect(isMealSlotId('natt')).toBe(false);
		expect(isMealSlotId('breakfast')).toBe(false);
		expect(isMealSlotId(null)).toBe(false);
		expect(isMealSlotId(3)).toBe(false);
	});
});

describe('mealSlotForTime', () => {
	it('deler døgnet slik en norsk dag ser ut', () => {
		expect(mealSlotForTime(osloSummer('06:43'))).toBe('frokost');
		expect(mealSlotForTime(osloSummer('11:00'))).toBe('lunsj');
		expect(mealSlotForTime(osloSummer('16:30'))).toBe('middag');
		expect(mealSlotForTime(osloSummer('21:00'))).toBe('kvelds');
	});

	it('treffer grensene presist', () => {
		expect(mealSlotForTime(osloSummer('04:00'))).toBe('frokost');
		expect(mealSlotForTime(osloSummer('10:29'))).toBe('frokost');
		expect(mealSlotForTime(osloSummer('10:30'))).toBe('lunsj');
		expect(mealSlotForTime(osloSummer('14:29'))).toBe('lunsj');
		expect(mealSlotForTime(osloSummer('14:30'))).toBe('middag');
		expect(mealSlotForTime(osloSummer('18:59'))).toBe('middag');
		expect(mealSlotForTime(osloSummer('19:00'))).toBe('kvelds');
	});

	it('lar kvelds strekke seg over midnatt', () => {
		// Nattmat er ikke frokost. Lifesum-settet har ingen natt-slot.
		expect(mealSlotForTime(osloSummer('23:30'))).toBe('kvelds');
		expect(mealSlotForTime(osloSummer('01:30'))).toBe('kvelds');
		expect(mealSlotForTime(osloSummer('03:59'))).toBe('kvelds');
	});

	it('bruker Osloklokka, ikke UTC', () => {
		// 09:00Z er 11:00 i Oslo om sommeren → lunsj, ikke frokost.
		expect(mealSlotForTime('2026-08-03T09:00:00.000Z')).toBe('lunsj');
		// Om vinteren er samme UTC-tid 10:00 norsk → fortsatt frokost.
		expect(mealSlotForTime('2026-01-15T09:00:00.000Z')).toBe('frokost');
	});

	it('returnerer aldri snacks — den kan bare velges', () => {
		for (let h = 0; h < 24; h++) {
			const slot = mealSlotForTime(osloSummer(`${String(h).padStart(2, '0')}:15`));
			expect(slot, `time ${h}`).not.toBe('snacks');
			expect(slot, `time ${h}`).not.toBeNull();
		}
	});

	it('gir null for ugyldig tidspunkt framfor å gjette', () => {
		expect(mealSlotForTime('tull')).toBeNull();
	});

	it('godtar Date like godt som streng', () => {
		expect(mealSlotForTime(new Date('2026-08-03T09:00:00.000Z'))).toBe('lunsj');
	});
});

describe('reslotAfterTimeChange', () => {
	it('flytter en utledet slot når tidspunktet rettes', () => {
		// Logget 13:00, men lunsjen var 11:00 — sloten var lunsj begge veier,
		// så bruk en rettelse som faktisk krysser en grense.
		const result = reslotAfterTimeChange(osloSummer('11:00'), { slot: 'middag', source: 'derived' });
		expect(result).toEqual({ slot: 'lunsj', source: 'derived' });
	});

	it('lar et bevisst valg stå', () => {
		// Har du sagt at det var snacks, skal ikke klokka overstyre deg.
		const result = reslotAfterTimeChange(osloSummer('11:00'), { slot: 'snacks', source: 'user' });
		expect(result).toEqual({ slot: 'snacks', source: 'user' });
	});

	it('setter slot når den manglet helt', () => {
		const result = reslotAfterTimeChange(osloSummer('16:30'), { slot: null, source: null });
		expect(result).toEqual({ slot: 'middag', source: 'derived' });
	});

	it('lar tilstanden stå når det nye tidspunktet er ugyldig', () => {
		const current = { slot: 'lunsj' as const, source: 'derived' as const };
		expect(reslotAfterTimeChange('tull', current)).toEqual(current);
	});
});
