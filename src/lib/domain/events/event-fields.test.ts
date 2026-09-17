import { describe, it, expect } from 'vitest';
import {
	coversDay,
	describeCountdown,
	eventSortKey,
	formatEventDate,
	formatEventPlace,
	formatEventTime,
	isPast,
	lastDayOf,
	normalizeEventDate,
	normalizeEventKind,
	normalizeEventTime,
	normalizeTicketCount,
	normalizeUrl,
	sortEvents,
	splitByTime
} from './event-fields';

describe('normalizeEventDate', () => {
	it('godtar en ekte dato', () => {
		expect(normalizeEventDate('2026-11-14')).toBe('2026-11-14');
	});

	it('avviser 31. februar — formen er gyldig, datoen er ikke', () => {
		expect(normalizeEventDate('2026-02-31')).toBeNull();
	});

	it('avviser tull', () => {
		expect(normalizeEventDate('14.11.2026')).toBeNull();
		expect(normalizeEventDate(null)).toBeNull();
		expect(normalizeEventDate('2026-13-01')).toBeNull();
	});
});

describe('normalizeEventTime', () => {
	it('godtar HH:MM', () => {
		expect(normalizeEventTime('19:30')).toBe('19:30');
	});

	it('godtar punktum og firesifret — billetter skriver tiden på alle tre måter', () => {
		expect(normalizeEventTime('19.30')).toBe('19:30');
		expect(normalizeEventTime('1930')).toBe('19:30');
	});

	it('padder timen', () => {
		expect(normalizeEventTime('9:05')).toBe('09:05');
	});

	it('avviser umulige klokkeslett', () => {
		expect(normalizeEventTime('25:00')).toBeNull();
		expect(normalizeEventTime('19:75')).toBeNull();
		expect(normalizeEventTime('')).toBeNull();
	});
});

describe('normalizeTicketCount', () => {
	it('tar tall og tallstrenger', () => {
		expect(normalizeTicketCount(2)).toBe(2);
		expect(normalizeTicketCount('4')).toBe(4);
	});

	it('avviser null, negative og absurde antall', () => {
		expect(normalizeTicketCount(0)).toBeNull();
		expect(normalizeTicketCount(-2)).toBeNull();
		expect(normalizeTicketCount(500)).toBeNull();
		expect(normalizeTicketCount('to')).toBeNull();
	});
});

describe('normalizeEventKind', () => {
	it('kjenner igjen kjente typer, uansett skrivemåte', () => {
		expect(normalizeEventKind('Konsert')).toBe('konsert');
		expect(normalizeEventKind(' teater ')).toBe('teater');
	});

	it('gir null på ukjent framfor å gjette «annet»', () => {
		expect(normalizeEventKind('foredrag')).toBeNull();
	});
});

describe('sortering', () => {
	const events = [
		{ eventDate: '2026-11-14', startTime: '19:30' },
		{ eventDate: '2026-11-14', startTime: null },
		{ eventDate: '2026-11-13', startTime: '20:00' }
	];

	it('sorterer på dato, så tid', () => {
		expect(sortEvents(events).map((e) => e.eventDate + (e.startTime ?? '-'))).toEqual([
			'2026-11-1320:00',
			'2026-11-1419:30',
			'2026-11-14-'
		]);
	});

	it('legger et arrangement uten tidspunkt SIST på dagen, ikke først', () => {
		expect(eventSortKey({ eventDate: '2026-11-14', startTime: null })).toBe('2026-11-14T24:00');
	});

	it('muterer ikke inndata', () => {
		const copy = [...events];
		sortEvents(events);
		expect(events).toEqual(copy);
	});
});

describe('lastDayOf og coversDay', () => {
	it('ser bort fra en sluttdato som ligger før starten', () => {
		expect(lastDayOf({ eventDate: '2026-11-14', endDate: '2026-11-01' })).toBe('2026-11-14');
	});

	it('dekker alle dagene i et flerdagsarrangement', () => {
		const festival = { eventDate: '2026-06-25', endDate: '2026-06-27' };
		expect(coversDay(festival, '2026-06-26')).toBe(true);
		expect(coversDay(festival, '2026-06-28')).toBe(false);
		expect(coversDay(festival, '2026-06-24')).toBe(false);
	});
});

describe('isPast', () => {
	it('holder arrangementet «kommende» hele dagen det skjer', () => {
		const kveld = new Date('2026-11-14T21:30:00Z'); // etter konserten
		expect(isPast({ eventDate: '2026-11-14' }, kveld)).toBe(false);
	});

	it('er over dagen etter', () => {
		expect(isPast({ eventDate: '2026-11-14' }, new Date('2026-11-15T09:00:00Z'))).toBe(true);
	});

	it('en festival er ikke over før siste dag er passert', () => {
		const midt = new Date('2026-06-26T12:00:00Z');
		expect(isPast({ eventDate: '2026-06-25', endDate: '2026-06-27' }, midt)).toBe(false);
	});
});

describe('splitByTime', () => {
	it('kommende stigende, tidligere med nyeste først', () => {
		const now = new Date('2026-11-14T12:00:00Z');
		const events = [
			{ eventDate: '2026-12-01', startTime: null },
			{ eventDate: '2026-11-14', startTime: '19:30' },
			{ eventDate: '2026-10-01', startTime: null },
			{ eventDate: '2026-09-01', startTime: null }
		];
		const { upcoming, past } = splitByTime(events, now);
		expect(upcoming.map((e) => e.eventDate)).toEqual(['2026-11-14', '2026-12-01']);
		expect(past.map((e) => e.eventDate)).toEqual(['2026-10-01', '2026-09-01']);
	});
});

describe('formatEventDate', () => {
	it('skriver ukedag og måned på norsk', () => {
		expect(formatEventDate('2026-11-14', new Date('2026-09-17T12:00:00Z'))).toBe('lørdag 14. november');
	});

	it('tar med årstall når det ikke er inneværende år', () => {
		expect(formatEventDate('2027-03-02', new Date('2026-09-17T12:00:00Z'))).toBe('tirsdag 2. mars 2027');
	});
});

describe('describeCountdown', () => {
	const now = new Date('2026-09-17T12:00:00Z');

	it('tier om det som er i dag — da sier datoen alt', () => {
		expect(describeCountdown({ eventDate: '2026-09-17' }, now)).toBeNull();
	});

	it('sier i morgen', () => {
		expect(describeCountdown({ eventDate: '2026-09-18' }, now)).toBe('I morgen');
	});

	it('teller dager under uka og uker over', () => {
		expect(describeCountdown({ eventDate: '2026-09-20' }, now)).toBe('Om 3 dager');
		expect(describeCountdown({ eventDate: '2026-10-15' }, now)).toBe('Om 4 uker');
	});

	it('går over til måneder når det er langt fram', () => {
		expect(describeCountdown({ eventDate: '2027-01-15' }, now)).toBe('Om 4 måneder');
	});

	it('tier om det som har vært', () => {
		expect(describeCountdown({ eventDate: '2026-09-01' }, now)).toBeNull();
	});
});

describe('formatEventTime', () => {
	it('nevner dørene bare når de er ulike starten', () => {
		expect(formatEventTime({ startTime: '19:30', doorsTime: '18:00' })).toBe('Dørene 18:00 · Start 19:30');
		expect(formatEventTime({ startTime: '19:30', doorsTime: '19:30' })).toBe('19:30');
	});

	it('klarer seg med bare det ene', () => {
		expect(formatEventTime({ startTime: '19:30' })).toBe('19:30');
		expect(formatEventTime({ doorsTime: '18:00' })).toBe('Dørene 18:00');
		expect(formatEventTime({})).toBeNull();
	});
});

describe('formatEventPlace', () => {
	it('tar med bare feltene som finnes', () => {
		expect(formatEventPlace({ venue: 'Oslo Spektrum', entrance: 'Inngang C', seat: 'Rad 12' })).toBe(
			'Oslo Spektrum · Inngang C · Rad 12'
		);
		expect(formatEventPlace({ venue: 'Sentrum Scene' })).toBe('Sentrum Scene');
		expect(formatEventPlace({ venue: '   ' })).toBeNull();
	});
});

describe('normalizeUrl', () => {
	it('godtar http og https', () => {
		expect(normalizeUrl('https://cosmopolite.no/billett/1')).toBe('https://cosmopolite.no/billett/1');
		expect(normalizeUrl('http://eksempel.no/')).toBe('http://eksempel.no/');
	});

	it('antar https når skjemaet mangler — det er det folk limer inn', () => {
		expect(normalizeUrl('cosmopolite.no/billett')).toBe('https://cosmopolite.no/billett');
	});

	it('avviser alt som ikke er http(s) — en href kjører i brukerens økt', () => {
		expect(normalizeUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
		expect(normalizeUrl('file:///etc/passwd')).toBeNull();
	});

	it('avviser tomt og tull', () => {
		expect(normalizeUrl('   ')).toBeNull();
		expect(normalizeUrl(null)).toBeNull();
		expect(normalizeUrl('https://')).toBeNull();
	});
});
