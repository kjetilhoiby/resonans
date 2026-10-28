import { describe, it, expect } from 'vitest';
import {
	checkRange,
	isValidIsoDate,
	isValidIsoWeek,
	normalizeItemText,
	osloDateOf,
	osloLocalToIso,
	osloTimeOf,
	parsePlanContext,
	parseStartTime,
	sortPlanItems,
	spondRsvp,
	toPlanItem,
	type PlanItemRowLike
} from './plan-items';

describe('datoer og klokkeslett', () => {
	it('godtar bare ekte kalenderdatoer', () => {
		expect(isValidIsoDate('2026-10-30')).toBe(true);
		expect(isValidIsoDate('2026-02-30')).toBe(false);
		expect(isValidIsoDate('30.10.2026')).toBe(false);
		expect(isValidIsoDate(undefined)).toBe(false);
	});

	it('godtar ISO-uker', () => {
		expect(isValidIsoWeek('2026-W44')).toBe(true);
		expect(isValidIsoWeek('2026-W54')).toBe(false);
		expect(isValidIsoWeek('2026-44')).toBe(false);
	});

	it('leser HH:MM', () => {
		expect(parseStartTime('11:00')).toEqual({ hour: 11, minute: 0 });
		expect(parseStartTime('9:05')).toEqual({ hour: 9, minute: 5 });
		expect(parseStartTime('24:00')).toBeNull();
		expect(parseStartTime('kl 11')).toBeNull();
	});

	it('avgrenser perioden', () => {
		expect(checkRange('2026-10-29', '2026-11-01')).toEqual({
			ok: true,
			dates: ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
		});
		expect(checkRange('2026-10-29', undefined)).toEqual({ ok: true, dates: ['2026-10-29'] });
		expect(checkRange('2026-11-01', '2026-10-29').ok).toBe(false);
		expect(checkRange('2026-01-01', '2026-03-01').ok).toBe(false);
	});
});

// Sommertida slutter 25. oktober 2026 og starter 29. mars 2026.
describe('osloLocalToIso — sommertid', () => {
	it('vintertid er +01:00', () => {
		expect(osloLocalToIso('2026-10-30', 11, 0)).toBe('2026-10-30T11:00:00+01:00');
	});

	it('sommertid er +02:00', () => {
		expect(osloLocalToIso('2026-10-24', 11, 0)).toBe('2026-10-24T11:00:00+02:00');
	});

	it('treffer riktig på begge sider av skiftet', () => {
		expect(osloLocalToIso('2026-10-25', 12, 0)).toBe('2026-10-25T12:00:00+01:00');
		expect(osloLocalToIso('2026-03-29', 12, 0)).toBe('2026-03-29T12:00:00+02:00');
		expect(osloLocalToIso('2026-03-28', 12, 0)).toBe('2026-03-28T12:00:00+01:00');
	});

	it('går fram og tilbake uten å flytte seg', () => {
		for (const iso of [osloLocalToIso('2026-10-30', 11, 0), osloLocalToIso('2026-07-01', 23, 30)]) {
			expect(osloTimeOf(iso)).toBe(iso.slice(11, 16));
			expect(osloDateOf(iso)).toBe(iso.slice(0, 10));
		}
	});

	// En Spond-kamp kl. 00:30 norsk sommertid er 22:30 UTC dagen før.
	it('osloDateOf gir den norske datoen, ikke UTC-datoen', () => {
		expect(osloDateOf('2026-06-13T22:30:00Z')).toBe('2026-06-14');
	});
});

describe('parsePlanContext', () => {
	it('kjenner dag- og ukelister', () => {
		expect(parsePlanContext('week:2026-W44:day:2026-10-30')).toEqual({ kind: 'day', week: '2026-W44', date: '2026-10-30' });
		expect(parsePlanContext('week:2026-W44')).toEqual({ kind: 'week', week: '2026-W44' });
	});

	it('avviser rutiner, prosjekter og annet', () => {
		expect(parsePlanContext('routine:abc:2026-10-30')).toBeNull();
		expect(parsePlanContext('tur')).toBeNull();
		expect(parsePlanContext(null)).toBeNull();
	});
});

function row(overrides: Partial<PlanItemRowLike> = {}): PlanItemRowLike {
	return {
		id: 'i1',
		text: 'Møte Magnus',
		checked: false,
		checkedAt: null,
		skippedAt: null,
		dueDate: null,
		estimateMinutes: null,
		projectId: null,
		parentId: null,
		createdAt: new Date('2026-10-28T10:00:00Z'),
		metadata: {},
		...overrides
	};
}

describe('toPlanItem', () => {
	const friday = { kind: 'day' as const, week: '2026-W44', date: '2026-10-30' };

	it('gir klokkeslett, tidspunkt med offset og varighet', () => {
		const item = toPlanItem(row({ metadata: { timeHour: 11, timeMinute: 0 }, estimateMinutes: 60 }), friday);
		expect(item).toMatchObject({
			list: 'day',
			date: '2026-10-30',
			startTime: '11:00',
			startsAt: '2026-10-30T11:00:00+01:00',
			durationMinutes: 60,
			status: 'open'
		});
	});

	it('et ukepunkt har uke, men ingen dato og intet tidspunkt', () => {
		const item = toPlanItem(row({ metadata: { timeHour: 21, timeMinute: 0 } }), { kind: 'week', week: '2026-W44' });
		expect(item).toMatchObject({ list: 'week', date: null, week: '2026-W44', startTime: '21:00', startsAt: null });
	});

	it('hopp over vinner over avkrysset', () => {
		expect(toPlanItem(row({ checked: true, skippedAt: new Date() }), friday).status).toBe('skipped');
		expect(toPlanItem(row({ checked: true, checkedAt: new Date('2026-10-30T12:00:00Z') }), friday)).toMatchObject({
			status: 'done',
			completedAt: '2026-10-30T12:00:00.000Z'
		});
	});

	it('bærer koblinger og person med seg', () => {
		const item = toPlanItem(
			row({ projectId: 'p1', metadata: { linkedTaskId: 't1', linkedChecklistItemId: 'w1', personName: 'Nils' } }),
			friday
		);
		expect(item.links).toEqual({ goalTaskId: 't1', weekItemId: 'w1', projectId: 'p1' });
		expect(item.personName).toBe('Nils');
	});
});

describe('sortPlanItems', () => {
	it('tidsfestede først etter klokkeslett, resten i rekkefølge', () => {
		const sorted = sortPlanItems([
			{ id: 'a', startTime: null },
			{ id: 'b', startTime: '12:00' },
			{ id: 'c', startTime: null },
			{ id: 'd', startTime: '08:30' }
		]);
		expect(sorted.map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
	});
});

describe('normalizeItemText', () => {
	it('ser bort fra store bokstaver og mellomrom', () => {
		expect(normalizeItemText('  Møte   Magnus ')).toBe(normalizeItemText('møte magnus'));
	});
});

describe('spondRsvp', () => {
	const mine = ['nils'];
	it('leser svaret til våre medlemmer', () => {
		expect(spondRsvp({ acceptedIds: ['nils', 'x'] }, mine)).toBe('accepted');
		expect(spondRsvp({ declinedIds: ['nils'] }, mine)).toBe('declined');
		expect(spondRsvp({ unansweredIds: ['nils'] }, mine)).toBe('unanswered');
		expect(spondRsvp({ waitinglistIds: ['nils'] }, mine)).toBe('waitinglist');
	});

	// En hendelse i gruppa uten noen av våre på lista er ikke noe barnet skal delta i.
	it('skiller «ikke invitert» fra «vet ikke»', () => {
		expect(spondRsvp({ acceptedIds: ['annen'] }, mine)).toBe('not_invited');
		expect(spondRsvp({ acceptedIds: ['nils'] }, [])).toBe('unknown');
	});
});
