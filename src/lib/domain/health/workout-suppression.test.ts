import { describe, it, expect } from 'vitest';
import {
	SUPPRESSION_TOLERANCE_MINUTES,
	isWorkoutSuppressed,
	suppressionLookupWindow
} from './workout-suppression';

const at = (iso: string) => new Date(iso);

describe('isWorkoutSuppressed', () => {
	const suppressions = [{ startTime: at('2026-08-13T15:48:00Z'), sportFamily: 'running' }];

	it('skjuler økta den ble laget for', () => {
		expect(
			isWorkoutSuppressed({ startTime: at('2026-08-13T15:48:00Z'), sportFamily: 'running' }, suppressions)
		).toBe(true);
	});

	it('tåler at kilden reviderer starttidspunktet', () => {
		// Withings justerer øktgrenser retroaktivt, og en annen kilde starter
		// sporingen noen minutter unna. Begge må fortsatt treffe.
		for (const iso of ['2026-08-13T15:31:00Z', '2026-08-13T16:05:00Z', '2026-08-13T16:17:59Z']) {
			expect(isWorkoutSuppressed({ startTime: at(iso), sportFamily: 'running' }, suppressions)).toBe(true);
		}
	});

	it('slipper økter utenfor toleransen gjennom', () => {
		expect(
			isWorkoutSuppressed({ startTime: at('2026-08-13T16:19:00Z'), sportFamily: 'running' }, suppressions)
		).toBe(false);
		expect(
			isWorkoutSuppressed({ startTime: at('2026-08-13T15:17:00Z'), sportFamily: 'running' }, suppressions)
		).toBe(false);
	});

	it('er symmetrisk rundt tidspunktet', () => {
		const before = at('2026-08-13T15:18:00Z');
		const after = at('2026-08-13T16:18:00Z');
		expect(isWorkoutSuppressed({ startTime: before, sportFamily: 'running' }, suppressions)).toBe(true);
		expect(isWorkoutSuppressed({ startTime: after, sportFamily: 'running' }, suppressions)).toBe(true);
	});

	it('skiller på sportsfamilie', () => {
		// En svartelistet løpetur skal ikke skjule en sykkeltur på samme klokkeslett.
		expect(
			isWorkoutSuppressed({ startTime: at('2026-08-13T15:48:00Z'), sportFamily: 'cycling' }, suppressions)
		).toBe(false);
	});

	it('gjelder uansett hvilken kilde økta kom fra', () => {
		// Hele poenget: svartelista kjenner ikke rad-id eller sensor. En økt som
		// dukker opp igjen etter en re-synk, med ny id, treffer fortsatt.
		const gjenoppstått = { startTime: at('2026-08-13T15:49:30Z'), sportFamily: 'running' };
		expect(isWorkoutSuppressed(gjenoppstått, suppressions)).toBe(true);
	});

	it('returnerer false uten svartelistinger', () => {
		expect(isWorkoutSuppressed({ startTime: at('2026-08-13T15:48:00Z'), sportFamily: 'running' }, [])).toBe(false);
	});

	it('tåler et ugyldig tidsstempel framfor å kaste', () => {
		expect(isWorkoutSuppressed({ startTime: new Date('tull'), sportFamily: 'running' }, suppressions)).toBe(false);
	});

	it('treffer på en av flere svartelistinger', () => {
		const flere = [
			{ startTime: at('2026-01-01T08:00:00Z'), sportFamily: 'running' },
			{ startTime: at('2026-08-13T15:48:00Z'), sportFamily: 'running' }
		];
		expect(isWorkoutSuppressed({ startTime: at('2026-08-13T15:50:00Z'), sportFamily: 'running' }, flere)).toBe(true);
	});
});

describe('suppressionLookupWindow', () => {
	it('padder bakover med toleransen', () => {
		// En svartelisting like før vinduet kan fortsatt treffe den første økta i
		// det. Uten paddingen slipper en økt i kanten gjennom.
		const since = at('2026-08-13T12:00:00Z');
		const from = suppressionLookupWindow(since);
		expect(since.getTime() - from.getTime()).toBe(SUPPRESSION_TOLERANCE_MINUTES * 60 * 1000);
	});
});
