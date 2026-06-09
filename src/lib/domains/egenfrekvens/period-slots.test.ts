import { describe, it, expect } from 'vitest';
import {
	displayPeriodSlotFor,
	getActivePeriodSlot,
	isPeriodSlotId,
	localIsoDay,
	periodSlotStorageKey,
	PERIOD_SLOT_GROUP,
	PERIOD_SLOTS
} from './period-slots';

function at(hours: number, minutes: number): Date {
	return new Date(2026, 5, 9, hours, minutes);
}

describe('getActivePeriodSlot', () => {
	it('gir natt fra 05:00 til 07:29', () => {
		expect(getActivePeriodSlot(at(5, 0))?.id).toBe('natt');
		expect(getActivePeriodSlot(at(7, 29))?.id).toBe('natt');
	});

	it('gir morgen fra 07:30 til 11:59', () => {
		expect(getActivePeriodSlot(at(7, 30))?.id).toBe('morgen');
		expect(getActivePeriodSlot(at(11, 59))?.id).toBe('morgen');
	});

	it('gir ingenting i lunsj-hullet 12:00–13:59', () => {
		expect(getActivePeriodSlot(at(12, 0))).toBeNull();
		expect(getActivePeriodSlot(at(13, 59))).toBeNull();
	});

	it('gir arbeidsdag fra 14:00 til 17:59', () => {
		expect(getActivePeriodSlot(at(14, 0))?.id).toBe('arbeidsdag');
		expect(getActivePeriodSlot(at(17, 59))?.id).toBe('arbeidsdag');
	});

	it('gir ettermiddag fra 18:00 til 19:59', () => {
		expect(getActivePeriodSlot(at(18, 0))?.id).toBe('ettermiddag');
		expect(getActivePeriodSlot(at(19, 59))?.id).toBe('ettermiddag');
	});

	it('gir kveld fra 20:00 til 23:59', () => {
		expect(getActivePeriodSlot(at(20, 0))?.id).toBe('kveld');
		expect(getActivePeriodSlot(at(23, 59))?.id).toBe('kveld');
	});

	it('gir ingenting om natta før 05:00', () => {
		expect(getActivePeriodSlot(at(0, 0))).toBeNull();
		expect(getActivePeriodSlot(at(4, 59))).toBeNull();
	});

	it('har sammenhengende vinduer uten overlapp', () => {
		const sorted = [...PERIOD_SLOTS].sort((a, b) => a.fromMinutes - b.fromMinutes);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i].fromMinutes).toBeGreaterThanOrEqual(sorted[i - 1].toMinutes);
		}
	});
});

describe('isPeriodSlotId', () => {
	it('godtar alle definerte slots', () => {
		for (const slot of PERIOD_SLOTS) expect(isPeriodSlotId(slot.id)).toBe(true);
	});

	it('avviser legacy-slots og ukjente verdier', () => {
		expect(isPeriodSlotId('morning')).toBe(false);
		expect(isPeriodSlotId('evening')).toBe(false);
		expect(isPeriodSlotId('')).toBe(false);
		expect(isPeriodSlotId(null)).toBe(false);
		expect(isPeriodSlotId(3)).toBe(false);
	});
});

describe('PERIOD_SLOT_GROUP', () => {
	it('mapper alle slots til morning eller evening', () => {
		for (const slot of PERIOD_SLOTS) {
			expect(['morning', 'evening']).toContain(PERIOD_SLOT_GROUP[slot.id]);
		}
	});
});

describe('displayPeriodSlotFor', () => {
	it('viser periode-slots som seg selv', () => {
		for (const slot of PERIOD_SLOTS) expect(displayPeriodSlotFor(slot.id)).toBe(slot.id);
	});

	it('mapper historiske morning/evening til morgen/kveld', () => {
		expect(displayPeriodSlotFor('morning')).toBe('morgen');
		expect(displayPeriodSlotFor('evening')).toBe('kveld');
	});

	it('avviser legacy-events uten gyldig slot', () => {
		expect(displayPeriodSlotFor(undefined)).toBeNull();
		expect(displayPeriodSlotFor(null)).toBeNull();
		expect(displayPeriodSlotFor('')).toBeNull();
		expect(displayPeriodSlotFor('noon')).toBeNull();
	});
});

describe('localIsoDay', () => {
	it('formaterer lokal dato som YYYY-MM-DD', () => {
		expect(localIsoDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
		expect(localIsoDay(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
	});
});

describe('periodSlotStorageKey', () => {
	it('inkluderer dag og slot', () => {
		expect(periodSlotStorageKey('2026-06-09', 'natt')).toBe('egenfrekvens-slot-2026-06-09-natt');
	});
});
