import { describe, it, expect } from 'vitest';
import {
	buildTicketDraft,
	draftIsUsable,
	parseEntrance,
	parseTicketDate,
	parseTicketTime
} from './ticket-extraction';

const NOW = new Date('2026-09-17T12:00:00Z');

describe('parseTicketDate', () => {
	it('tar ISO rett', () => {
		expect(parseTicketDate('2026-11-14', NOW)).toBe('2026-11-14');
	});

	it('tar norsk punktumdato', () => {
		expect(parseTicketDate('14.11.2026', NOW)).toBe('2026-11-14');
		expect(parseTicketDate('14/11/26', NOW)).toBe('2026-11-14');
	});

	it('tar månedsnavn med og uten ukedag', () => {
		expect(parseTicketDate('fredag 14. november 2026', NOW)).toBe('2026-11-14');
		expect(parseTicketDate('14. nov 2026', NOW)).toBe('2026-11-14');
		expect(parseTicketDate('2. mars 2027', NOW)).toBe('2027-03-02');
	});

	it('uten årstall velges første framtidige forekomst', () => {
		expect(parseTicketDate('14. november', NOW)).toBe('2026-11-14');
		// Mars har vært i 2026 — billetten gjelder da 2027.
		expect(parseTicketDate('2. mars', NOW)).toBe('2027-03-02');
	});

	it('i dag teller som framtidig — en billett lest om morgenen gjelder i kveld', () => {
		expect(parseTicketDate('17. september', NOW)).toBe('2026-09-17');
	});

	it('gir null framfor å gjette', () => {
		expect(parseTicketDate('en gang til høsten', NOW)).toBeNull();
		expect(parseTicketDate(null, NOW)).toBeNull();
		expect(parseTicketDate('', NOW)).toBeNull();
	});
});

describe('parseTicketTime', () => {
	it('plukker tiden ut av fritekst', () => {
		expect(parseTicketTime('kl. 19:30')).toBe('19:30');
		expect(parseTicketTime('Dørene åpner 18.00')).toBe('18:00');
	});

	it('krever minutter — «kl 19» kan være 19:30, og en tapt halvtime er verre enn et tomt felt', () => {
		expect(parseTicketTime('kl 19')).toBeNull();
	});
});

describe('parseEntrance', () => {
	it('beholder ordlyden fra billetten', () => {
		expect(parseEntrance('Inngang C')).toBe('Inngang C');
		expect(parseEntrance('Port 2')).toBe('Port 2');
	});

	it('setter på ordet når det bare står en bokstav', () => {
		expect(parseEntrance('C')).toBe('Inngang C');
		expect(parseEntrance('12')).toBe('Inngang 12');
	});

	it('null på tomt', () => {
		expect(parseEntrance('  ')).toBeNull();
		expect(parseEntrance(undefined)).toBeNull();
	});
});

describe('buildTicketDraft', () => {
	it('bygger et komplett utkast uten advarsler', () => {
		const draft = buildTicketDraft(
			{
				title: 'Karpe — Omar Sheriff',
				kind: 'Konsert',
				eventDate: '14.11.2026',
				startTime: '19.30',
				doorsTime: '18:00',
				venue: 'Oslo Spektrum',
				entrance: 'C',
				seat: 'Rad 12, sete 5',
				ticketCount: '2',
				bookingReference: 'TM-99182',
				confidence: 'high'
			},
			NOW
		);

		expect(draft.title).toBe('Karpe — Omar Sheriff');
		expect(draft.kind).toBe('konsert');
		expect(draft.eventDate).toBe('2026-11-14');
		expect(draft.startTime).toBe('19:30');
		expect(draft.doorsTime).toBe('18:00');
		expect(draft.entrance).toBe('Inngang C');
		expect(draft.ticketCount).toBe(2);
		expect(draft.confidence).toBe('high');
		expect(draft.warnings).toEqual([]);
	});

	it('sier fra når datoen mangler', () => {
		const draft = buildTicketDraft({ title: 'Noe' }, NOW);
		expect(draft.eventDate).toBeNull();
		expect(draft.warnings).toContain('Fant ingen dato — fyll den inn selv.');
		expect(draft.warnings).toContain('Fant ikke klokkeslett.');
	});

	it('sier fra at årstallet ble utledet — det er en slutning, ikke en avlesning', () => {
		const draft = buildTicketDraft({ title: 'X', eventDate: '14. november', startTime: '19:30' }, NOW);
		expect(draft.eventDate).toBe('2026-11-14');
		expect(draft.warnings).toContain('Årstallet sto ikke på billetten — satt til 2026.');
	});

	it('dropper dørene når de er like starten', () => {
		const draft = buildTicketDraft({ title: 'X', eventDate: '2026-11-14', startTime: '19:30', doorsTime: '19:30' }, NOW);
		expect(draft.doorsTime).toBeNull();
	});

	it('forkaster en sluttdato som ligger før starten, og sier det', () => {
		const draft = buildTicketDraft(
			{ title: 'X', eventDate: '2026-11-14', endDate: '2026-11-01', startTime: '19:30' },
			NOW
		);
		expect(draft.endDate).toBeNull();
		expect(draft.warnings).toContain('Sluttdatoen lå før startdatoen og ble forkastet.');
	});

	it('beholder en ekte sluttdato', () => {
		const draft = buildTicketDraft(
			{ title: 'Festival', eventDate: '2026-06-25', endDate: '2026-06-27', startTime: '12:00' },
			NOW
		);
		expect(draft.endDate).toBe('2026-06-27');
	});

	it('slipper ikke gjennom felter ingen har validert', () => {
		const draft = buildTicketDraft({ title: 'X', eventDate: '2026-11-14', status: 'cancelled', userId: 'noen-andre' }, NOW);
		expect(draft as unknown as Record<string, unknown>).not.toHaveProperty('status');
		expect(draft as unknown as Record<string, unknown>).not.toHaveProperty('userId');
	});

	it('tåler at modellen svarer med noe helt annet', () => {
		expect(() => buildTicketDraft(null, NOW)).not.toThrow();
		expect(() => buildTicketDraft('beklager, jeg klarte ikke', NOW)).not.toThrow();
		expect(buildTicketDraft(null, NOW).confidence).toBe('low');
	});

	it('faller til low på ukjent confidence', () => {
		expect(buildTicketDraft({ confidence: 'ganske sikker' }, NOW).confidence).toBe('low');
	});
});

describe('draftIsUsable', () => {
	it('krever tittel eller dato', () => {
		expect(draftIsUsable(buildTicketDraft({ title: 'Karpe' }, NOW))).toBe(true);
		expect(draftIsUsable(buildTicketDraft({ eventDate: '2026-11-14' }, NOW))).toBe(true);
		expect(draftIsUsable(buildTicketDraft({ venue: 'Oslo Spektrum' }, NOW))).toBe(false);
	});
});
