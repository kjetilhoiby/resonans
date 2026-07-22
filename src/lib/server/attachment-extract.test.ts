import { describe, it, expect } from 'vitest';
import { mergeVideoContent, parseCloudinaryVideoForm } from './attachment-extract';

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

describe('parseCloudinaryVideoForm', () => {
	it('returnerer null uten riktig mode', () => {
		const fd = new FormData();
		fd.append('publicId', 'resonans/abc');
		expect(parseCloudinaryVideoForm(fd)).toBeNull();
	});

	it('returnerer null når publicId mangler', () => {
		const fd = new FormData();
		fd.append('mode', 'video-remote');
		expect(parseCloudinaryVideoForm(fd)).toBeNull();
	});

	it('parser publicId, note, source, name og varighet', () => {
		const fd = new FormData();
		fd.append('mode', 'video-remote');
		fd.append('publicId', 'resonans/abc');
		fd.append('durationSec', '42.5');
		fd.append('note', '  klipp fra økta  ');
		fd.append('source', 'file');
		fd.append('name', 'IMG_0515.mov');
		expect(parseCloudinaryVideoForm(fd)).toEqual({
			publicId: 'resonans/abc',
			note: 'klipp fra økta',
			source: 'file',
			name: 'IMG_0515.mov',
			durationSec: 42.5
		});
	});

	it('utelater varighet når den er ugyldig', () => {
		const fd = new FormData();
		fd.append('mode', 'video-remote');
		fd.append('publicId', 'resonans/abc');
		fd.append('durationSec', 'tull');
		expect(parseCloudinaryVideoForm(fd)?.durationSec).toBeUndefined();
	});
});
