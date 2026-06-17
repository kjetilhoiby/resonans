import { describe, it, expect } from 'vitest';
import {
	normalizeSender,
	validateMessageInput,
	parseAfterMarker,
	MAX_SENDER_LEN,
	MAX_TEXT_LEN,
	DIRECTION_VIEWER_TO_RUNNER,
	DIRECTION_RUNNER_TO_VIEWER
} from './live-messages';

describe('normalizeSender', () => {
	it('trimmer og beholder navn', () => {
		expect(normalizeSender('  Kjetil  ')).toBe('Kjetil');
	});

	it('returnerer null for tomt eller ikke-streng', () => {
		expect(normalizeSender('')).toBeNull();
		expect(normalizeSender('   ')).toBeNull();
		expect(normalizeSender(undefined)).toBeNull();
		expect(normalizeSender(42)).toBeNull();
	});

	it('kapper til maks lengde', () => {
		const long = 'a'.repeat(MAX_SENDER_LEN + 20);
		expect(normalizeSender(long)).toHaveLength(MAX_SENDER_LEN);
	});
});

describe('validateMessageInput', () => {
	it('godtar gyldig melding med avsender', () => {
		const result = validateMessageInput({ sender: 'Kjetil', text: 'Bra jobba!' });
		expect(result).toEqual({ ok: true, value: { sender: 'Kjetil', text: 'Bra jobba!' } });
	});

	it('godtar melding uten avsender (sender = null)', () => {
		const result = validateMessageInput({ text: 'Heia!' });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.sender).toBeNull();
	});

	it('avviser når text mangler eller ikke er streng', () => {
		expect(validateMessageInput({ sender: 'Kjetil' }).ok).toBe(false);
		expect(validateMessageInput({ text: 123 }).ok).toBe(false);
	});

	it('avviser tom text etter trimming', () => {
		expect(validateMessageInput({ text: '   ' }).ok).toBe(false);
	});

	it('kapper text defensivt i stedet for å avvise', () => {
		const long = 'b'.repeat(MAX_TEXT_LEN + 100);
		const result = validateMessageInput({ text: long });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.text).toHaveLength(MAX_TEXT_LEN);
	});
});

describe('meldingsretninger', () => {
	it('har to distinkte retninger', () => {
		expect(DIRECTION_VIEWER_TO_RUNNER).toBe('viewer_to_runner');
		expect(DIRECTION_RUNNER_TO_VIEWER).toBe('runner_to_viewer');
		expect(DIRECTION_VIEWER_TO_RUNNER).not.toBe(DIRECTION_RUNNER_TO_VIEWER);
	});
});

describe('parseAfterMarker', () => {
	it('parser gyldig markør', () => {
		expect(parseAfterMarker('42')).toBe(42);
	});

	it('returnerer null for utelatt/tom/ugyldig', () => {
		expect(parseAfterMarker(null)).toBeNull();
		expect(parseAfterMarker(undefined)).toBeNull();
		expect(parseAfterMarker('')).toBeNull();
		expect(parseAfterMarker('abc')).toBeNull();
		expect(parseAfterMarker('-5')).toBeNull();
	});

	it('gulver desimaltall', () => {
		expect(parseAfterMarker('7.9')).toBe(7);
	});
});
