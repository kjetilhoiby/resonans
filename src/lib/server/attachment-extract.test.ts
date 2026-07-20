import { describe, it, expect } from 'vitest';
import { pickFrameOffsets, formatTimestamp, mergeVideoContent } from './attachment-extract';

describe('pickFrameOffsets', () => {
	it('returnerer tomt for ugyldig varighet', () => {
		expect(pickFrameOffsets(0)).toEqual([]);
		expect(pickFrameOffsets(-5)).toEqual([]);
		expect(pickFrameOffsets(Number.NaN)).toEqual([]);
	});

	it('sampler inntil maks-antall for lang video', () => {
		const offsets = pickFrameOffsets(60);
		expect(offsets).toHaveLength(6);
	});

	it('sampler færre for kort video', () => {
		expect(pickFrameOffsets(16)).toHaveLength(2);
	});

	it('holder seg strengt innenfor (0, varighet) og er stigende', () => {
		const offsets = pickFrameOffsets(60);
		for (const t of offsets) {
			expect(t).toBeGreaterThan(0);
			expect(t).toBeLessThan(60);
		}
		const sorted = [...offsets].sort((a, b) => a - b);
		expect(offsets).toEqual(sorted);
	});

	it('respekterer et lavere maks-tak', () => {
		expect(pickFrameOffsets(120, 3)).toHaveLength(3);
	});
});

describe('formatTimestamp', () => {
	it('formaterer sekunder som m:ss', () => {
		expect(formatTimestamp(5)).toBe('0:05');
		expect(formatTimestamp(65)).toBe('1:05');
		expect(formatTimestamp(0)).toBe('0:00');
		expect(formatTimestamp(9.6)).toBe('0:10');
	});
});

describe('mergeVideoContent', () => {
	it('fletter tale og keyframes', () => {
		const { contentText, extractionKind } = mergeVideoContent('Hei, dette er en test.', 'En person snakker til kamera.');
		expect(extractionKind).toBe('video_transcript_and_frames');
		expect(contentText).toContain('[Tale (transkribert)]');
		expect(contentText).toContain('[Visuelt innhold (keyframes)]');
		expect(contentText).toContain('Hei, dette er en test.');
		expect(contentText).toContain('En person snakker til kamera.');
	});

	it('gir video_frames når bare det visuelle finnes', () => {
		const { contentText, extractionKind } = mergeVideoContent('', 'Grafer på en skjerm.');
		expect(extractionKind).toBe('video_frames');
		expect(contentText).toContain('[Visuelt innhold (keyframes)]');
		expect(contentText).not.toContain('[Tale');
	});

	it('gir video_audio_transcript når bare tale finnes', () => {
		const { extractionKind } = mergeVideoContent('Bare lyd her.', '');
		expect(extractionKind).toBe('video_audio_transcript');
	});

	it('gir metadata_only når begge er tomme', () => {
		const { contentText, extractionKind } = mergeVideoContent('   ', '');
		expect(extractionKind).toBe('metadata_only');
		expect(contentText).toBe('');
	});
});
