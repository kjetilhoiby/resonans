import { describe, it, expect } from 'vitest';
import { mergeVideoContent } from './attachment-extract';

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
