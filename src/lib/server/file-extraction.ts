/**
 * file-extraction.ts
 *
 * Central service for extracting text/semantic content from uploaded files.
 * Supports: PDF, plain text/CSV/MD, images (GPT-4o vision), audio/video (Whisper).
 *
 * Adding a new format: add a branch in `extractFileContent` — nothing else needs to change.
 */

import { openai } from './openai';

// @ts-ignore
const BufferGlobal = Buffer;

export type ExtractionKind =
	| 'pdf_text'
	| 'image_vision'
	| 'audio_transcript'
	| 'plain_text'
	| 'unsupported';

export interface FileExtractionResult {
	text: string;
	kind: ExtractionKind;
}

/** Max chars stored per file — keeps memory payloads sane */
const MAX_CHARS = 6000;

function clamp(text: string, max = MAX_CHARS): string {
	const trimmed = text
		.replace(/\r/g, '')
		.replace(/\u0000/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max).trim()}\n\n[innhold kuttet ved ${max} tegn]`;
}

/* ── Extractors ──────────────────────────────────────────── */

async function extractPdf(buffer: Buffer): Promise<string> {
	const { extractText } = await import('unpdf');
	const { text } = await extractText(new Uint8Array(buffer));
	const raw = Array.isArray(text) ? text.join('\n\n') : (text as string);
	return clamp(raw);
}

async function extractImage(cloudinaryUrl: string): Promise<string> {
	const response = await openai.chat.completions.create({
		model: 'gpt-4o',
		max_tokens: 1500,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `Du er en assistent som ekstraherer nyttig informasjon fra bilder for kontekst i en personlig coaching-app.

Beskriv bildets innhold på norsk. Fokuser på:
- All synlig tekst og tall (skjermbilder, tabeller, grafer, dokumenter)
- Trenings- eller helsedata (puls, distanse, tid, soner, intensitet o.l.)
- Skjermtidsdata (app-bruk, kategorier, daglige totaler)
- Andre detaljer relevante for trening, helse, økonomi eller personlig utvikling

Vær presis og kortfattet. Maks 400 ord.`
					},
					{
						type: 'image_url',
						image_url: { url: cloudinaryUrl, detail: 'high' }
					}
				]
			}
		]
	});
	return clamp(response.choices[0]?.message?.content ?? '');
}

async function extractAudio(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
	const isVideo = mimeType.startsWith('video/');
	const file = new File([buffer], filename, {
		type: mimeType || (isVideo ? 'video/mp4' : 'audio/mpeg')
	});
	const transcription = await openai.audio.transcriptions.create({
		file,
		model: 'gpt-4o-mini-transcribe',
		language: 'no'
	});
	return clamp(transcription.text ?? '');
}

export interface WordTimestamp {
	word: string;
	start: number;
	end: number;
}

export interface AudioTranscriptionResult {
	text: string;
	words: WordTimestamp[];
}

/**
 * Transcribe audio/video and return text + empty words array.
 * Uses gpt-4o-mini-transcribe for best quality. Word timestamps are not
 * available on this model, so words is always empty.
 *
 * TODO: Vurder Deepgram Nova-2 ($0.0043/min) for bedre norsk + ord-timestamps (karaoke).
 *   Docs: https://developers.deepgram.com/docs/getting-started-with-pre-recorded-audio
 */
export async function transcribeAudioWithWords(
	buffer: Buffer,
	filename: string,
	mimeType: string
): Promise<AudioTranscriptionResult> {
	const isVideo = mimeType.startsWith('video/');
	const file = new File([buffer], filename, {
		type: mimeType || (isVideo ? 'video/mp4' : 'audio/mpeg')
	});
	const transcription = await openai.audio.transcriptions.create({
		file,
		model: 'gpt-4o-mini-transcribe',
		language: 'no'
	});
	return { text: clamp(transcription.text ?? ''), words: [] };
}

function extractPlainText(buffer: Buffer): string {
	return clamp(buffer.toString('utf-8'));
}

/* ── Main entry point ────────────────────────────────────── */

/**
 * Extract text content from a file buffer.
 *
 * @param buffer          Raw file bytes (available before Cloudinary upload)
 * @param mimeType        MIME type from the uploaded File object
 * @param filename        Original filename (used for extension-based detection)
 * @param cloudinaryUrl   Required for image extraction via GPT-4o vision
 */
export async function extractFileContent(
	buffer: Buffer,
	mimeType: string,
	filename: string,
	cloudinaryUrl?: string
): Promise<FileExtractionResult> {
	const mime = mimeType.toLowerCase();
	const name = filename.toLowerCase();

	// PDF
	if (mime.includes('pdf') || name.endsWith('.pdf')) {
		try {
			const text = await extractPdf(buffer);
			return { text, kind: 'pdf_text' };
		} catch (err) {
			console.error('[file-extraction] PDF failed:', err);
			return { text: '', kind: 'unsupported' };
		}
	}

	// Image — needs Cloudinary URL for vision call
	if (mime.startsWith('image/')) {
		if (!cloudinaryUrl) return { text: '', kind: 'unsupported' };
		try {
			const text = await extractImage(cloudinaryUrl);
			return { text, kind: 'image_vision' };
		} catch (err) {
			console.error('[file-extraction] Vision failed:', err);
			return { text: '', kind: 'unsupported' };
		}
	}

	// Audio / video → Whisper transcription
	if (mime.startsWith('audio/') || mime.startsWith('video/')) {
		try {
			const text = await extractAudio(buffer, filename, mimeType);
			return { text, kind: 'audio_transcript' };
		} catch (err) {
			console.error('[file-extraction] Audio transcription failed:', err);
			return { text: '', kind: 'unsupported' };
		}
	}

	// Plain text, MD, CSV
	if (
		mime.startsWith('text/') ||
		['.txt', '.md', '.csv'].some((ext) => name.endsWith(ext))
	) {
		return { text: extractPlainText(buffer), kind: 'plain_text' };
	}

	return { text: '', kind: 'unsupported' };
}
