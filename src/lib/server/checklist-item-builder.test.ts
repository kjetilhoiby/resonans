import { describe, it, expect } from 'vitest';
import { buildChecklistItemFields, extractWeekKeys } from './checklist-item-builder';

const USER = 'test-user';

/**
 * Disse testene dekker de DB-frie greinene i builderen (generell liste,
 * sted, reise, wake-time). Tids-/aktivitets-/koblings-greinene slår opp i
 * databasen og testes ikke her — de underliggende parserne har egne tester.
 */

describe('extractWeekKeys', () => {
	it('trekker ut uke-nøkler fra dag-kontekst', () => {
		expect(extractWeekKeys('week:2026-W16:day:2026-04-13')).toEqual({
			dashedKey: '2026-W16',
			compactKey: '2026W16'
		});
	});

	it('returnerer null for generell kontekst', () => {
		expect(extractWeekKeys('tur')).toBeNull();
		expect(extractWeekKeys(null)).toBeNull();
	});
});

describe('buildChecklistItemFields — generell liste', () => {
	it('lar ren tekst stå urørt uten kontekst', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: null,
			text: 'Kjøpe melk'
		});
		expect(fields.text).toBe('Kjøpe melk');
		expect(fields.startDate).toBeNull();
		expect(fields.metadata).toEqual({});
		expect(fields.locationDayIso).toBeNull();
	});

	it('tagger aktivitetsord også på generelle lister (for auto-haking)', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: 'pakkeliste',
			text: 'Yoga'
		});
		expect(fields.metadata).toEqual({ activityType: 'yoga' });
	});
});

describe('buildChecklistItemFields — dag-nivå sted/reise', () => {
	const dayContext = 'week:2026-W16:day:2026-04-13';

	it('tolker «Sted: X» som sted-punkt og synker opphold for dagen', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: dayContext,
			text: 'Sted: Trondheim'
		});
		expect(fields.text).toBe('Trondheim');
		expect(fields.metadata).toMatchObject({ kind: 'location', locationName: 'Trondheim' });
		expect(fields.locationDayIso).toBe('2026-04-13');
	});

	it('tolker reise med klokkeslett i punktum-format og stripper tiden fra teksten', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: dayContext,
			text: 'Kjøre til Oslo kl 18.00'
		});
		expect(fields.text).toBe('Kjøre til Oslo');
		expect(fields.metadata).toMatchObject({
			kind: 'travel',
			travelMode: 'drive',
			destination: 'Oslo',
			timeHour: 18,
			timeMinute: 0
		});
	});

	it('tolker «innen 18:00» som ankomstfrist, ikke avgangstid', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: dayContext,
			text: 'Kjøre til Oslo innen 18:00'
		});
		expect(fields.text).toBe('Kjøre til Oslo');
		expect(fields.metadata).toMatchObject({
			kind: 'travel',
			travelMode: 'drive',
			destination: 'Oslo',
			arriveByHour: 18,
			arriveByMinute: 0
		});
		// Fristen skal ikke bli avgangstid.
		expect(fields.metadata.timeHour).toBeUndefined();
	});

	it('skiller avgang («kl 14») fra ankomstfrist («innen 18»)', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: dayContext,
			text: 'Kjøre til Oslo kl 14 innen 18:30'
		});
		expect(fields.text).toBe('Kjøre til Oslo');
		expect(fields.metadata).toMatchObject({
			kind: 'travel',
			travelMode: 'drive',
			destination: 'Oslo',
			timeHour: 14,
			timeMinute: 0,
			arriveByHour: 18,
			arriveByMinute: 30
		});
	});
});

describe('buildChecklistItemFields — wake-time på ukenivå', () => {
	it('tolker «stå opp kl. 6» som wake-mål uten oppgavekobling', async () => {
		const fields = await buildChecklistItemFields({
			userId: USER,
			context: 'week:2026-W16',
			text: 'Stå opp kl. 6'
		});
		expect(fields.metadata).toEqual({ wakeTargetHour: 6, wakeTargetMinute: 0 });
		expect(fields.locationDayIso).toBeNull();
	});
});
