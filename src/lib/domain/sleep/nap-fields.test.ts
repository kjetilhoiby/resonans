import { describe, it, expect } from 'vitest';
import {
	napCapabilities,
	normalizeNapNote,
	validateNapDuration,
	validateNapStart,
	NAP_FUTURE_TOLERANCE_MINUTES,
	NAP_MAX_MINUTES,
	NAP_MIN_MINUTES,
	NAP_NOTE_MAX_LENGTH
} from './nap-fields';

describe('napCapabilities', () => {
	it('lar manuelle dupper rettes og slettes', () => {
		expect(napCapabilities({ manual: true })).toEqual({
			canEdit: true,
			canDelete: true,
			canReclassify: false
		});
	});

	it('gir oppdagede dupper omklassifisering i stedet for sletting', () => {
		// En Withings-måling er en ekte måling av at du lå stille. Det som er vårt, og
		// derfor kan rettes, er klassifiseringen.
		expect(napCapabilities({ manual: false })).toEqual({
			canEdit: false,
			canDelete: false,
			canReclassify: true
		});
	});
});

describe('validateNapDuration', () => {
	it('godtar spennet, inkludert grensene', () => {
		expect(validateNapDuration(NAP_MIN_MINUTES)).toBeNull();
		expect(validateNapDuration(NAP_MAX_MINUTES)).toBeNull();
		expect(validateNapDuration(25)).toBeNull();
	});

	it('avviser for kort og for langt', () => {
		expect(validateNapDuration(4)).toMatch(/mellom 5 og 180/);
		expect(validateNapDuration(181)).toMatch(/mellom 5 og 180/);
		expect(validateNapDuration(0)).toMatch(/mellom 5 og 180/);
	});

	it('avviser ikke-tall', () => {
		expect(validateNapDuration('25')).toBe('Varigheten må være et tall.');
		expect(validateNapDuration(null)).toBe('Varigheten må være et tall.');
		expect(validateNapDuration(Number.NaN)).toBe('Varigheten må være et tall.');
	});
});

describe('normalizeNapNote', () => {
	it('skiller «ikke rørt» fra «slett notatet»', () => {
		expect(normalizeNapNote(undefined)).toBeUndefined();
		expect(normalizeNapNote('')).toBeNull();
		expect(normalizeNapNote('   ')).toBeNull();
		expect(normalizeNapNote(null)).toBeNull();
	});

	it('trimmer og beholder innhold', () => {
		expect(normalizeNapNote('  sofaen  ')).toBe('sofaen');
	});

	it('kutter et notat som har blitt en dagbok', () => {
		const long = 'a'.repeat(NAP_NOTE_MAX_LENGTH + 50);
		expect(normalizeNapNote(long)).toHaveLength(NAP_NOTE_MAX_LENGTH);
	});

	it('ignorerer feil type framfor å kaste', () => {
		expect(normalizeNapNote(42)).toBeUndefined();
	});
});

describe('validateNapStart', () => {
	const now = new Date('2026-08-04T12:00:00Z');

	it('godtar et tidspunkt i fortiden', () => {
		expect(validateNapStart(new Date('2026-08-04T10:00:00Z'), now)).toBeNull();
	});

	it('avviser framtiden, men tåler en klokke som ligger litt foran', () => {
		const justAhead = new Date(now.getTime() + (NAP_FUTURE_TOLERANCE_MINUTES - 1) * 60_000);
		expect(validateNapStart(justAhead, now)).toBeNull();

		const tooFar = new Date(now.getTime() + (NAP_FUTURE_TOLERANCE_MINUTES + 2) * 60_000);
		expect(validateNapStart(tooFar, now)).toBe('Tidspunktet kan ikke være i framtiden.');
	});

	it('avviser en ugyldig dato', () => {
		expect(validateNapStart(new Date('tull'), now)).toBe('Ugyldig tidspunkt.');
	});
});
