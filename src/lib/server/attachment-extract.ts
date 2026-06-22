/**
 * Delt opplastings- og uttrekks-kjerne for vedlegg.
 *
 * Sideeffekt-fri: laster opp til Cloudinary og trekker ut tekstinnhold
 * (PDF/DOCX/XLSX/CSV/TXT) eller transkriberer lyd/video. Ingen LLM-triage,
 * ingen tracking-/skjermtid-registrering — det hører til
 * `/api/attachment-triage` (den kalde innboks-flyten på hjemskjermen).
 *
 * Brukes av:
 *   - `/api/attachment-extract` — slankt endepunkt for chat-vedlegg (kontekst
 *     håndteres av selve chatturen).
 *   - `/api/attachment-triage` — kald triage som bygger videre på samme kjerne.
 */

import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import JSZip from 'jszip';

// @ts-ignore - Buffer is available in Node.js runtime
const BufferGlobal = Buffer;

export type AttachmentKind = 'image' | 'audio' | 'document' | 'other';
export type AttachmentSource = 'camera' | 'file' | 'voice';

export interface AttachmentExtraction {
	contentText: string;
	extractionKind:
		| 'vision'
		| 'audio_transcript'
		| 'video_audio_transcript'
		| 'pdf_text'
		| 'docx_text'
		| 'sheet_text'
		| 'plain_text'
		| 'metadata_only';
}

export interface ExtractedAttachment {
	url: string;
	publicId: string;
	kind: AttachmentKind;
	name: string;
	mimeType: string;
	note: string;
	source: AttachmentSource;
	sizeBytes: number;
	contentText: string;
	extractionKind: AttachmentExtraction['extractionKind'];
}

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

export function detectAttachmentKind(file: File): AttachmentKind {
	const mimeType = file.type.toLowerCase();
	const fileName = file.name.toLowerCase();

	if (mimeType.startsWith('image/')) return 'image';
	// Video behandles som lyd-likt innhold så vi kan transkribere tale.
	if (mimeType.startsWith('video/')) return 'audio';
	if (mimeType.startsWith('audio/')) return 'audio';
	if (
		mimeType.includes('pdf') ||
		mimeType.includes('word') ||
		mimeType.includes('sheet') ||
		mimeType.includes('text/') ||
		fileName.endsWith('.pdf') ||
		fileName.endsWith('.doc') ||
		fileName.endsWith('.docx') ||
		fileName.endsWith('.xls') ||
		fileName.endsWith('.xlsx') ||
		fileName.endsWith('.csv') ||
		fileName.endsWith('.txt')
	) {
		return 'document';
	}

	return 'other';
}

export function normalizeAttachmentSource(value: unknown): AttachmentSource {
	return value === 'camera' || value === 'file' || value === 'voice' ? value : 'file';
}

function decodeXmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#10;/g, '\n')
		.replace(/&#9;/g, '\t');
}

function cleanExtractedText(value: string): string {
	return decodeXmlEntities(value)
		.replace(/\r/g, '')
		.replace(/\u0000/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

function limitContent(value: string, maxChars = 6000): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars).trim()}\n\n[innhold kuttet]`;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
	const { extractText } = await import('unpdf');
	const { text } = await extractText(new Uint8Array(buffer));
	const raw = Array.isArray(text) ? text.join('\n\n') : text;
	return cleanExtractedText(raw);
}

async function extractDocxText(buffer: Buffer): Promise<string> {
	const zip = await JSZip.loadAsync(buffer);
	const docXml = await zip.file('word/document.xml')?.async('string');
	if (!docXml) return '';

	const withStructure = docXml
		.replace(/<w:tab\b[^>]*\/>/g, '\t')
		.replace(/<w:br\b[^>]*\/>/g, '\n')
		.replace(/<w:p\b[^>]*>/g, '\n')
		.replace(/<\/w:p>/g, '\n');

	return cleanExtractedText(withStructure.replace(/<[^>]+>/g, ' '));
}

function parseSharedStrings(xml: string): string[] {
	const strings: string[] = [];
	const regex = /<si[\s\S]*?<\/si>/g;
	for (const match of xml.match(regex) ?? []) {
		const textParts = [...match.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]);
		strings.push(cleanExtractedText(textParts.join('')));
	}
	return strings;
}

function columnRefToIndex(ref: string): number {
	const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
	let index = 0;
	for (const char of letters) {
		index = index * 26 + (char.charCodeAt(0) - 64);
	}
	return Math.max(0, index - 1);
}

function extractCellValue(cellXml: string, sharedStrings: string[]): { ref: string; value: string } | null {
	const refMatch = cellXml.match(/\br="([A-Z]+\d+)"/i);
	const typeMatch = cellXml.match(/\bt="([^"]+)"/i);
	const inlineText = [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join('');
	const rawValue = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inlineText;
	if (!refMatch || !rawValue) return null;

	const cellType = typeMatch?.[1] ?? '';
	let value = rawValue;
	if (cellType === 's') {
		const idx = Number.parseInt(rawValue, 10);
		value = Number.isFinite(idx) ? sharedStrings[idx] ?? '' : '';
	}

	return {
		ref: refMatch[1],
		value: cleanExtractedText(value)
	};
}

async function extractSheetText(buffer: Buffer): Promise<string> {
	const zip = await JSZip.loadAsync(buffer);
	const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
	const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
	const worksheetNames = Object.keys(zip.files)
		.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

	const sheetTexts: string[] = [];
	for (const sheetName of worksheetNames.slice(0, 4)) {
		const xml = await zip.file(sheetName)?.async('string');
		if (!xml) continue;

		const rows: string[] = [];
		for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
			const rowXml = rowMatch[1];
			const cells: string[] = [];
			for (const cellMatch of rowXml.matchAll(/<c\b[\s\S]*?<\/c>/g)) {
				const parsed = extractCellValue(cellMatch[0], sharedStrings);
				if (!parsed || !parsed.value) continue;
				const colIndex = columnRefToIndex(parsed.ref);
				cells[colIndex] = parsed.value;
			}

			const line = cells.filter((value) => typeof value === 'string' && value.length > 0).join('\t');
			if (line) rows.push(line);
		}

		if (rows.length > 0) {
			sheetTexts.push(rows.slice(0, 40).join('\n'));
		}
	}

	return cleanExtractedText(sheetTexts.join('\n\n'));
}

export async function extractTextContent(
	file: File,
	buffer: Buffer,
	kind: AttachmentKind
): Promise<AttachmentExtraction> {
	const mimeType = file.type.toLowerCase();
	const fileName = file.name.toLowerCase();
	const isVideoSource =
		mimeType.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm'].some((ext) => fileName.endsWith(ext));

	if (kind === 'audio') {
		try {
			const transcription = await openai.audio.transcriptions.create({
				file: new File([new Uint8Array(buffer)], file.name, {
					type: file.type || (isVideoSource ? 'video/mp4' : 'audio/mpeg')
				}),
				model: 'gpt-4o-mini-transcribe'
			});
			const transcript = cleanExtractedText(transcription.text ?? '');
			return {
				contentText: limitContent(transcript),
				extractionKind: transcript ? (isVideoSource ? 'video_audio_transcript' : 'audio_transcript') : 'metadata_only'
			};
		} catch (error) {
			console.error('Audio transcription failed:', error);
			return { contentText: '', extractionKind: 'metadata_only' };
		}
	}

	if (kind !== 'document') {
		return { contentText: '', extractionKind: kind === 'image' ? 'vision' : 'metadata_only' };
	}

	try {
		if (fileName.endsWith('.pdf') || mimeType.includes('pdf')) {
			return { contentText: limitContent(await extractPdfText(buffer)), extractionKind: 'pdf_text' };
		}

		if (fileName.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
			return { contentText: limitContent(await extractDocxText(buffer)), extractionKind: 'docx_text' };
		}

		if (fileName.endsWith('.xlsx') || mimeType.includes('spreadsheetml') || mimeType.includes('sheet')) {
			return { contentText: limitContent(await extractSheetText(buffer)), extractionKind: 'sheet_text' };
		}

		if (fileName.endsWith('.csv') || fileName.endsWith('.txt') || mimeType.startsWith('text/')) {
			return {
				contentText: limitContent(cleanExtractedText(buffer.toString('utf-8'))),
				extractionKind: 'plain_text'
			};
		}
	} catch (error) {
		console.error('Document extraction failed:', error);
	}

	return { contentText: '', extractionKind: 'metadata_only' };
}

/**
 * Laster opp en fil til Cloudinary og trekker ut innhold. Returnerer selve
 * vedleggsobjektet samt buffer/extraction slik at den kalde triagen kan bygge
 * videre (bilde-signatur, byte-hash, osv.) uten å laste opp på nytt.
 */
export async function uploadAndExtractAttachment(
	file: File,
	note: string,
	source: AttachmentSource
): Promise<{ attachment: ExtractedAttachment; buffer: Buffer; extraction: AttachmentExtraction }> {
	const kind = detectAttachmentKind(file);
	const arrayBuffer = await file.arrayBuffer();
	const buffer = BufferGlobal.from(arrayBuffer);
	const extraction = await extractTextContent(file, buffer, kind);
	const base64 = buffer.toString('base64');
	const dataUri = `data:${file.type || 'application/octet-stream'};base64,${base64}`;

	const uploadOptions =
		kind === 'image'
			? {
					folder: 'resonans',
					resource_type: 'image' as const,
					transformation: [
						{ width: 1600, height: 1600, crop: 'limit' },
						{ quality: 'auto:good' },
						{ fetch_format: 'auto' }
					]
				}
			: {
					folder: 'resonans',
					resource_type: 'auto' as const,
					use_filename: true,
					unique_filename: true
				};

	const uploaded = await cloudinary.uploader.upload(dataUri, uploadOptions);

	const attachment: ExtractedAttachment = {
		url: uploaded.secure_url,
		publicId: uploaded.public_id,
		kind,
		name: file.name,
		mimeType: file.type,
		note,
		source,
		sizeBytes: file.size,
		contentText: extraction.contentText,
		extractionKind: extraction.extractionKind
	};

	return { attachment, buffer, extraction };
}
