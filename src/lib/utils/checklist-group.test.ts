import { describe, it, expect } from 'vitest';
import {
	activityTypeEmoji,
	groupChecklistItems,
	sortByTime,
	sortByStatus,
	formatItemTime,
	stripTimeFromText,
	parseLocationPrefix,
	parseTravelPrefix,
	extractArriveBy,
	aggregateStays
} from './checklist-group';

describe('activityTypeEmoji', () => {
	it('kjente aktivitetstyper', () => {
		expect(activityTypeEmoji('yoga')).toBe('🧘');
		expect(activityTypeEmoji('cycling')).toBe('🚴');
		expect(activityTypeEmoji('ebike')).toBe('🚴');
		expect(activityTypeEmoji('strength')).toBe('🏋️');
		expect(activityTypeEmoji('running')).toBe('🏃');
	});

	it('ukjent type → fallback ✅', () => {
		expect(activityTypeEmoji('whatever')).toBe('✅');
	});
});

describe('groupChecklistItems', () => {
	it('grupperer repeat-slots og lar enkeltpunkter være single', () => {
		const items = [
			{ text: 'Yoga (1/3)' },
			{ text: 'Yoga (2/3)' },
			{ text: 'Yoga (3/3)' },
			{ text: 'Handle' }
		];
		const groups = groupChecklistItems(items);
		const group = groups.find((g) => g.type === 'group');
		expect(group?.type).toBe('group');
		if (group?.type === 'group') expect(group.items.length).toBe(3);
		expect(groups.some((g) => g.type === 'single')).toBe(true);
	});
});

describe('sortByTime', () => {
	it('sorterer tidfestede items etter klokkeslett', () => {
		const items = [
			{ text: 'Lunsj', metadata: { timeHour: 12, timeMinute: 0 } },
			{ text: 'Frokost', metadata: { timeHour: 7, timeMinute: 30 } },
			{ text: 'Middag', metadata: { timeHour: 18, timeMinute: 0 } }
		];
		const sorted = sortByTime(items);
		expect(sorted[0].text).toBe('Frokost');
		expect(sorted[1].text).toBe('Lunsj');
		expect(sorted[2].text).toBe('Middag');
	});

	it('legger items uten tid sist', () => {
		const items = [
			{ text: 'Uten tid', metadata: {} },
			{ text: 'Med tid', metadata: { timeHour: 8, timeMinute: 0 } }
		];
		const sorted = sortByTime(items);
		expect(sorted[0].text).toBe('Med tid');
		expect(sorted[1].text).toBe('Uten tid');
	});
});

describe('sortByStatus', () => {
	it('sorterer: åpne → avkryssede → strøkne', () => {
		const items = [
			{ text: 'Strøket', checked: false, skippedAt: '2025-01-01' },
			{ text: 'Ferdig', checked: true },
			{ text: 'Åpen', checked: false }
		];
		const sorted = sortByStatus(items);
		expect(sorted[0].text).toBe('Åpen');
		expect(sorted[1].text).toBe('Ferdig');
		expect(sorted[2].text).toBe('Strøket');
	});

	it('beholder rekkefølge innen hver bøtte', () => {
		const items = [
			{ text: 'A', checked: false },
			{ text: 'B', checked: false },
			{ text: 'C', checked: false }
		];
		const sorted = sortByStatus(items);
		expect(sorted.map((i) => i.text)).toEqual(['A', 'B', 'C']);
	});
});

describe('formatItemTime', () => {
	it('formaterer klokkeslett med ledende null', () => {
		expect(formatItemTime(8, 5)).toBe('08:05');
		expect(formatItemTime(14, 30)).toBe('14:30');
		expect(formatItemTime(0, 0)).toBe('00:00');
	});
});

describe('stripTimeFromText', () => {
	it('fjerner «kl. 14:30»', () => {
		expect(stripTimeFromText('Møte kl. 14:30 med legen')).toBe('Møte med legen');
	});

	it('fjerner «klokka 08»', () => {
		expect(stripTimeFromText('Frokost klokka 08')).toBe('Frokost');
	});

	it('fjerner bare «HH:MM»', () => {
		expect(stripTimeFromText('Lunsj 12:00')).toBe('Lunsj');
	});

	it('fjerner «HH.MM»', () => {
		expect(stripTimeFromText('Trening 16.30')).toBe('Trening');
	});

	it('returnerer originaltekst hvis tom etter stripping', () => {
		expect(stripTimeFromText('14:30')).toBe('14:30');
	});

	it('lar tekst uten tid være i fred', () => {
		expect(stripTimeFromText('Handle mat')).toBe('Handle mat');
	});
});

describe('parseLocationPrefix', () => {
	it('parser «Sted: Trondheim»', () => {
		expect(parseLocationPrefix('Sted: Trondheim')).toEqual({ name: 'Trondheim' });
	});

	it('er case-insensitive', () => {
		expect(parseLocationPrefix('STED: Oslo')).toEqual({ name: 'Oslo' });
		expect(parseLocationPrefix('sted: bergen')).toEqual({ name: 'bergen' });
	});

	it('håndterer fullbredde kolon', () => {
		expect(parseLocationPrefix('Sted：Stavanger')).toEqual({ name: 'Stavanger' });
	});

	it('returnerer null for vanlige punkter', () => {
		expect(parseLocationPrefix('Handle mat')).toBeNull();
		expect(parseLocationPrefix('Kjøre til byen')).toBeNull();
	});

	it('returnerer null for tom stedsnavn', () => {
		expect(parseLocationPrefix('Sted: ')).toBeNull();
	});
});

describe('parseTravelPrefix', () => {
	it('parser kjøre-varianter', () => {
		expect(parseTravelPrefix('Kjøre til Trondheim')).toEqual({ mode: 'drive', destination: 'Trondheim' });
		expect(parseTravelPrefix('Kjør til Oslo')).toEqual({ mode: 'drive', destination: 'Oslo' });
		expect(parseTravelPrefix('Kjøretur til Bergen')).toEqual({ mode: 'drive', destination: 'Bergen' });
	});

	it('parser båt/ferge', () => {
		expect(parseTravelPrefix('Båt til Håøya')).toEqual({ mode: 'boat', destination: 'Håøya' });
		expect(parseTravelPrefix('Ferge til Nesodden')).toEqual({ mode: 'boat', destination: 'Nesodden' });
	});

	it('parser fly', () => {
		expect(parseTravelPrefix('Fly til Oslo')).toEqual({ mode: 'flight', destination: 'Oslo' });
		expect(parseTravelPrefix('Flyr til Bergen')).toEqual({ mode: 'flight', destination: 'Bergen' });
	});

	it('stripper klokkeslett fra destinasjon', () => {
		const result = parseTravelPrefix('Kjøre til Trondheim kl 12.00');
		expect(result).toEqual({ mode: 'drive', destination: 'Trondheim' });
	});

	it('returnerer null for vanlige punkter', () => {
		expect(parseTravelPrefix('Handle mat')).toBeNull();
		expect(parseTravelPrefix('Sted: Oslo')).toBeNull();
	});

	it('parser ankomstfrist «innen HH:MM» uten å forveksle den med destinasjon', () => {
		expect(parseTravelPrefix('Kjøre til Oslo innen 18:00')).toEqual({
			mode: 'drive',
			destination: 'Oslo',
			arriveByHour: 18,
			arriveByMinute: 0
		});
	});

	it('parser «innen kl 18» og «innen 18» (uten minutter)', () => {
		expect(parseTravelPrefix('Kjøre til Oslo innen kl 18')).toEqual({
			mode: 'drive',
			destination: 'Oslo',
			arriveByHour: 18,
			arriveByMinute: 0
		});
		expect(parseTravelPrefix('Fly til Bergen innen 9')).toEqual({
			mode: 'flight',
			destination: 'Bergen',
			arriveByHour: 9,
			arriveByMinute: 0
		});
	});

	it('skiller avgangstid («kl 14») fra ankomstfrist («innen 18»)', () => {
		expect(parseTravelPrefix('Kjøre til Oslo kl 14 innen 18:30')).toEqual({
			mode: 'drive',
			destination: 'Oslo',
			arriveByHour: 18,
			arriveByMinute: 30
		});
	});

	it('uten «innen» settes ingen ankomstfrist', () => {
		expect(parseTravelPrefix('Kjøre til Oslo kl 18:00')).toEqual({
			mode: 'drive',
			destination: 'Oslo'
		});
	});
});

describe('extractArriveBy', () => {
	it('trekker ut «innen 18:00» og fjerner leddet fra teksten', () => {
		expect(extractArriveBy('Oslo innen 18:00')).toEqual({
			deadline: { hour: 18, minute: 0 },
			rest: 'Oslo'
		});
	});

	it('håndterer «innen kl. 9» og fyller minutt 0', () => {
		expect(extractArriveBy('Bergen innen kl. 9')).toEqual({
			deadline: { hour: 9, minute: 0 },
			rest: 'Bergen'
		});
	});

	it('returnerer null + uendret tekst uten frist', () => {
		expect(extractArriveBy('Oslo kl 18:00')).toEqual({ deadline: null, rest: 'Oslo kl 18:00' });
	});

	it('avviser ugyldig klokkeslett', () => {
		expect(extractArriveBy('Oslo innen 25:00')).toEqual({
			deadline: null,
			rest: 'Oslo innen 25:00'
		});
	});
});

describe('aggregateStays', () => {
	it('slår sammen sammenhengende dager på samme sted', () => {
		const entries = [
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-02', place: 'Oslo' },
			{ date: '2025-07-03', place: 'Oslo' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(1);
		expect(stays[0]).toEqual({ place: 'Oslo', startDate: '2025-07-01', endDate: '2025-07-03', lat: undefined, lon: undefined });
	});

	it('splitter ved ulikt sted', () => {
		const entries = [
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-02', place: 'Bergen' },
			{ date: '2025-07-03', place: 'Bergen' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(2);
		expect(stays[0].place).toBe('Oslo');
		expect(stays[1].place).toBe('Bergen');
	});

	it('splitter ved hull > 1 dag', () => {
		const entries = [
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-05', place: 'Oslo' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(2);
	});

	it('er case-insensitive på stedsnavn', () => {
		const entries = [
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-02', place: 'oslo' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(1);
	});

	it('sorterer usorterte entries etter dato', () => {
		const entries = [
			{ date: '2025-07-03', place: 'Oslo' },
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-02', place: 'Oslo' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(1);
		expect(stays[0].startDate).toBe('2025-07-01');
		expect(stays[0].endDate).toBe('2025-07-03');
	});

	it('tar med lat/lon fra første entry som har det', () => {
		const entries = [
			{ date: '2025-07-01', place: 'Oslo' },
			{ date: '2025-07-02', place: 'Oslo', lat: 59.9, lon: 10.7 }
		];
		const stays = aggregateStays(entries);
		expect(stays[0].lat).toBe(59.9);
		expect(stays[0].lon).toBe(10.7);
	});

	it('filtrerer entries uten place eller date', () => {
		const entries = [
			{ date: '', place: 'Oslo' },
			{ date: '2025-07-01', place: '' },
			{ date: '2025-07-02', place: 'Bergen' }
		];
		const stays = aggregateStays(entries);
		expect(stays).toHaveLength(1);
		expect(stays[0].place).toBe('Bergen');
	});

	it('returnerer tom liste for tom input', () => {
		expect(aggregateStays([])).toEqual([]);
	});
});
