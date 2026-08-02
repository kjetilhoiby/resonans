import { describe, it, expect } from 'vitest';
import { mapSignalRow, type LatestSignalRow } from './signal-reader';

function row(overrides: Partial<LatestSignalRow> = {}): LatestSignalRow {
	return {
		signal_type: 'training_balance',
		owner_domain: 'health',
		value_number: '62.5',
		value_text: 'styrke',
		value_bool: null,
		severity: 'medium',
		confidence: '0.7',
		observed_at: '2026-08-01T06:00:00.000Z',
		context: { score: 62.5 },
		...overrides
	};
}

describe('mapSignalRow', () => {
	it('mapper snake_case-kolonner til camelCase-felter', () => {
		const signal = mapSignalRow(row());
		expect(signal.signalType).toBe('training_balance');
		expect(signal.ownerDomain).toBe('health');
		expect(signal.valueText).toBe('styrke');
		expect(signal.severity).toBe('medium');
		expect(signal.context).toEqual({ score: 62.5 });
	});

	it('konverterer numeric fra streng til tall', () => {
		// Postgres numeric kommer som streng over wire — uten Number() ville
		// terskelsammenligninger i presentasjonslaget blitt strengsammenligning.
		expect(mapSignalRow(row({ value_number: '62.5' })).valueNumber).toBe(62.5);
		expect(mapSignalRow(row({ value_number: -1.5 })).valueNumber).toBe(-1.5);
	});

	it('skiller null fra 0 i valueNumber', () => {
		expect(mapSignalRow(row({ value_number: null })).valueNumber).toBeNull();
		expect(mapSignalRow(row({ value_number: '0' })).valueNumber).toBe(0);
	});

	it('normaliserer observed_at til ISO uansett om driveren gir Date eller streng', () => {
		const fromString = mapSignalRow(row({ observed_at: '2026-08-01T06:00:00.000Z' }));
		const fromDate = mapSignalRow(row({ observed_at: new Date('2026-08-01T06:00:00.000Z') }));
		expect(fromString.observedAt).toBe('2026-08-01T06:00:00.000Z');
		expect(fromDate.observedAt).toBe(fromString.observedAt);
	});

	it('gjør confidence til streng uansett innkommende type', () => {
		expect(mapSignalRow(row({ confidence: 0.85 })).confidence).toBe('0.85');
		expect(mapSignalRow(row({ confidence: '0.85' })).confidence).toBe('0.85');
	});

	it('faller tilbake til tomt objekt når context er null', () => {
		expect(mapSignalRow(row({ context: null })).context).toEqual({});
	});

	it('bevarer valueBool inkludert false', () => {
		expect(mapSignalRow(row({ value_bool: false })).valueBool).toBe(false);
		expect(mapSignalRow(row({ value_bool: true })).valueBool).toBe(true);
		expect(mapSignalRow(row({ value_bool: null })).valueBool).toBeNull();
	});
});
