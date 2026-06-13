import { describe, it, expect } from 'vitest';
import {
	displayPeriodSlotFor,
	getActivePeriodSlot,
	isPeriodSlotId,
	isWeekendDay,
	localIsoDay,
	periodSlotStorageKey,
	PERIOD_SLOT_GROUP,
	PERIOD_SLOTS,
	WEEKEND_SLOTS,
	WORKDAY_SLOTS
} from './period-slots';

// 9. juni 2026 er en tirsdag (hverdag), 13. juni 2026 er en lørdag (helg).
function weekdayAt(hours: number, minutes: number): Date {
	return new Date(2026, 5, 9, hours, minutes);
}
function weekendAt(hours: number, minutes: number): Date {
	return new Date(2026, 5, 13, hours, minutes);
}

describe('getActivePeriodSlot – hverdag', () => {
	it('gir natt fra 05:00 til 07:29', () => {
		expect(getActivePeriodSlot(weekdayAt(5, 0))?.id).toBe('natt');
		expect(getActivePeriodSlot(weekdayAt(7, 29))?.id).toBe('natt');
	});

	it('gir morgen fra 07:30 til 11:59', () => {
		expect(getActivePeriodSlot(weekdayAt(7, 30))?.id).toBe('morgen');
		expect(getActivePeriodSlot(weekdayAt(11, 59))?.id).toBe('morgen');
	});

	it('gir ingenting i lunsj-hullet 12:00–13:59', () => {
		expect(getActivePeriodSlot(weekdayAt(12, 0))).toBeNull();
		expect(getActivePeriodSlot(weekdayAt(13, 59))).toBeNull();
	});

	it('gir arbeidsdag fra 14:00 til 17:59', () => {
		expect(getActivePeriodSlot(weekdayAt(14, 0))?.id).toBe('arbeidsdag');
		expect(getActivePeriodSlot(weekdayAt(17, 59))?.id).toBe('arbeidsdag');
	});

	it('gir ettermiddag fra 18:00 til 19:59', () => {
		expect(getActivePeriodSlot(weekdayAt(18, 0))?.id).toBe('ettermiddag');
		expect(getActivePeriodSlot(weekdayAt(19, 59))?.id).toBe('ettermiddag');
	});

	it('gir kveld fra 20:00 til 23:59', () => {
		expect(getActivePeriodSlot(weekdayAt(20, 0))?.id).toBe('kveld');
		expect(getActivePeriodSlot(weekdayAt(23, 59))?.id).toBe('kveld');
	});

	it('gir ingenting om natta før 05:00', () => {
		expect(getActivePeriodSlot(weekdayAt(0, 0))).toBeNull();
		expect(getActivePeriodSlot(weekdayAt(4, 59))).toBeNull();
	});

	it('viser aldri arbeidsdag/ettermiddag på en helg', () => {
		// Samme klokkeslett som over, men på lørdag → roligere skjema.
		expect(getActivePeriodSlot(weekendAt(16, 46))?.id).toBe('dag');
		expect(getActivePeriodSlot(weekendAt(18, 30))?.id).toBe('dag');
	});
});

describe('getActivePeriodSlot – helg/fridag', () => {
	it('gir natt fra 05:00 til 06:59 (kortere enn hverdag)', () => {
		expect(getActivePeriodSlot(weekendAt(5, 0))?.id).toBe('natt');
		expect(getActivePeriodSlot(weekendAt(6, 59))?.id).toBe('natt');
	});

	it('gir morgen fra 07:00 til 09:59', () => {
		expect(getActivePeriodSlot(weekendAt(7, 0))?.id).toBe('morgen');
		expect(getActivePeriodSlot(weekendAt(9, 59))?.id).toBe('morgen');
	});

	it('gir dag fra 10:00 til 18:59', () => {
		expect(getActivePeriodSlot(weekendAt(10, 0))?.id).toBe('dag');
		expect(getActivePeriodSlot(weekendAt(18, 59))?.id).toBe('dag');
	});

	it('gir kveld fra 19:00 til 22:59', () => {
		expect(getActivePeriodSlot(weekendAt(19, 0))?.id).toBe('kveld');
		expect(getActivePeriodSlot(weekendAt(22, 59))?.id).toBe('kveld');
	});

	it('gir ingenting etter 23:00', () => {
		expect(getActivePeriodSlot(weekendAt(23, 0))).toBeNull();
		expect(getActivePeriodSlot(weekendAt(23, 59))).toBeNull();
	});

	it('respekterer eksplisitt nonWorkingDay uavhengig av ukedag (helligdag på hverdag)', () => {
		// Tirsdag, men markert som fridag → helg-skjema, ikke arbeidsdag.
		expect(getActivePeriodSlot(weekdayAt(16, 46), true)?.id).toBe('dag');
		// Lørdag, men tvunget til arbeidsdag-skjema.
		expect(getActivePeriodSlot(weekendAt(16, 46), false)?.id).toBe('arbeidsdag');
	});
});

describe('isWeekendDay', () => {
	it('kjenner igjen lørdag og søndag', () => {
		expect(isWeekendDay(new Date(2026, 5, 13))).toBe(true); // lørdag
		expect(isWeekendDay(new Date(2026, 5, 14))).toBe(true); // søndag
	});
	it('avviser hverdager', () => {
		expect(isWeekendDay(new Date(2026, 5, 9))).toBe(false); // tirsdag
	});
});

describe('WORKDAY_SLOTS / WEEKEND_SLOTS', () => {
	it('har sammenhengende vinduer uten overlapp innen hvert skjema', () => {
		for (const schedule of [WORKDAY_SLOTS, WEEKEND_SLOTS]) {
			const sorted = [...schedule].sort((a, b) => a.fromMinutes - b.fromMinutes);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i].fromMinutes).toBeGreaterThanOrEqual(sorted[i - 1].toMinutes);
			}
		}
	});

	it('helg-skjemaet bruker dag i stedet for arbeidsdag/ettermiddag', () => {
		const ids = WEEKEND_SLOTS.map((s) => s.id);
		expect(ids).toContain('dag');
		expect(ids).not.toContain('arbeidsdag');
		expect(ids).not.toContain('ettermiddag');
	});
});

describe('isPeriodSlotId', () => {
	it('godtar alle definerte slots, inkl. dag', () => {
		for (const slot of PERIOD_SLOTS) expect(isPeriodSlotId(slot.id)).toBe(true);
		expect(isPeriodSlotId('dag')).toBe(true);
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
