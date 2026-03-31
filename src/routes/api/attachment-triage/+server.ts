import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import JSZip from 'jszip';

// @ts-ignore - Buffer is available in Node.js runtime
const BufferGlobal = Buffer;

type AttachmentKind = 'image' | 'audio' | 'document' | 'other';
type AttachmentSource = 'camera' | 'file' | 'voice';

interface SuggestedAction {
	id: string;
	label: string;
	prompt: string;
}

interface AttachmentTriageResult {
	summary: string;
	clarificationQuestion: string;
	suggestedActions: SuggestedAction[];
	detectedIntent: string;
	confidence: 'low' | 'medium' | 'high';
	extractedSignals: string[];
}

interface AttachmentExtraction {
	contentText: string;
	extractionKind: 'vision' | 'audio_transcript' | 'video_audio_transcript' | 'pdf_text' | 'docx_text' | 'sheet_text' | 'plain_text' | 'metadata_only';
}

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

function detectAttachmentKind(file: File): AttachmentKind {
	const mimeType = file.type.toLowerCase();
	const fileName = file.name.toLowerCase();

	if (mimeType.startsWith('image/')) return 'image';
	// Video treated as audio-like content so we can transcribe spoken content.
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

function formatSize(sizeBytes: number): string {
	if (sizeBytes < 1024 * 1024) {
		return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
	}

	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildAttachmentContext(params: {
	name: string;
	mimeType: string;
	sizeBytes: number;
	kind: AttachmentKind;
	note: string;
	source: AttachmentSource;
	contentText?: string;
	extractionKind?: AttachmentExtraction['extractionKind'];
}) {
	return [
		`Filnavn: ${params.name}`,
		`Mime-type: ${params.mimeType || 'ukjent'}`,
		`Størrelse: ${formatSize(params.sizeBytes)}`,
		`Kategori: ${params.kind}`,
		`Kilde: ${params.source}`,
		`Brukernotat: ${params.note || '(tomt)'}`,
		params.extractionKind ? `Innholdskilde: ${params.extractionKind}` : null,
		params.contentText ? `Ekstrahert innhold:\n${params.contentText}` : null
	].join('\n');
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

async function extractTextContent(file: File, buffer: Buffer, kind: AttachmentKind): Promise<AttachmentExtraction> {
	const mimeType = file.type.toLowerCase();
	const fileName = file.name.toLowerCase();
	const isVideoSource = mimeType.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm'].some((ext) => fileName.endsWith(ext));

	if (kind === 'audio') {
		try {
			const transcription = await openai.audio.transcriptions.create({
				file: new File([buffer], file.name, { type: file.type || (isVideoSource ? 'video/mp4' : 'audio/mpeg') }),
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

function parseTriageResult(content: string | null | undefined): Partial<AttachmentTriageResult> | null {
	if (!content) return null;

	try {
		return JSON.parse(content) as Partial<AttachmentTriageResult>;
	} catch {
		return null;
	}
}

function buildFallbackTriage(kind: AttachmentKind, note: string, name: string): AttachmentTriageResult {
	const subject = note || name;

	if (kind === 'image') {
		return {
			summary: `Jeg har lastet opp ${name}. Dette ser ut som noe som bør avklares før vi sender det videre i samtalen.`,
			clarificationQuestion: 'Hva vil du at vi skal bruke bildet til?',
			suggestedActions: [
				{ id: 'image-observe', label: 'Se på bildet', prompt: `Se på dette bildet og fortell hva som er viktig å legge merke til. ${subject}`.trim() },
				{ id: 'image-next-step', label: 'Finn neste steg', prompt: `Bruk dette bildet til å foreslå neste steg. ${subject}`.trim() },
				{ id: 'image-theme', label: 'Knytt til tema', prompt: `Hvilket tema hører dette bildet best hjemme under, og hvorfor? ${subject}`.trim() }
			],
			detectedIntent: 'avklare-bilde',
			confidence: 'medium',
			extractedSignals: [name]
		};
	}

	if (kind === 'audio') {
		return {
			summary: `Jeg har lastet opp ${name}. Før vi går videre trenger jeg å avklare hva du vil ha ut av lydvedlegget.`,
			clarificationQuestion: 'Vil du bruke dette som et lydnotat, noe som skal sorteres, eller bare som et vedlegg i en samtale?',
			suggestedActions: [
				{ id: 'audio-context', label: 'Legg på kontekst', prompt: `Jeg vil legge til kontekst rundt dette lydvedlegget: ${subject}`.trim() },
				{ id: 'audio-theme', label: 'Plasser i tema', prompt: `Hjelp meg å plassere dette lydvedlegget i riktig tema. ${subject}`.trim() },
				{ id: 'audio-next-step', label: 'Foreslå neste steg', prompt: `Jeg vil bruke dette lydvedlegget som utgangspunkt for neste steg. Hva trenger du fra meg? ${subject}`.trim() }
			],
			detectedIntent: 'avklare-lyd',
			confidence: 'low',
			extractedSignals: [name]
		};
	}

	return {
		summary: `Jeg har lastet opp ${name}. Dette bør triageres før det sendes videre inn i en vanlig chatflyt.`,
		clarificationQuestion: 'Hva vil du ha ut av dette vedlegget?',
		suggestedActions: [
			{ id: 'doc-context', label: 'Legg på kontekst', prompt: `Jeg vil forklare hva dette vedlegget gjelder: ${subject}`.trim() },
			{ id: 'doc-theme', label: 'Plasser i tema', prompt: `Hjelp meg å plassere dette vedlegget i riktig tema. ${subject}`.trim() },
			{ id: 'doc-next-step', label: 'Finn neste steg', prompt: `Jeg vil bruke dette vedlegget til å finne neste steg. Hva trenger du fra meg? ${subject}`.trim() }
		],
		detectedIntent: 'avklare-dokument',
		confidence: 'low',
		extractedSignals: [name]
	};
}

function normalizeSuggestedActions(
	kind: AttachmentKind,
	note: string,
	name: string,
	raw: Partial<AttachmentTriageResult> | null
): AttachmentTriageResult {
	const fallback = buildFallbackTriage(kind, note, name);
	const suggestedActions = Array.isArray(raw?.suggestedActions)
		? raw!.suggestedActions
			.filter((item): item is SuggestedAction => Boolean(item?.id && item?.label && item?.prompt))
			.slice(0, 3)
		: fallback.suggestedActions;

	return {
		summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : fallback.summary,
		clarificationQuestion:
			typeof raw?.clarificationQuestion === 'string' && raw.clarificationQuestion.trim()
				? raw.clarificationQuestion.trim()
				: fallback.clarificationQuestion,
		suggestedActions: suggestedActions.length > 0 ? suggestedActions : fallback.suggestedActions,
		detectedIntent:
			typeof raw?.detectedIntent === 'string' && raw.detectedIntent.trim()
				? raw.detectedIntent.trim()
				: fallback.detectedIntent,
		confidence:
			raw?.confidence === 'low' || raw?.confidence === 'medium' || raw?.confidence === 'high'
				? raw.confidence
				: fallback.confidence,
		extractedSignals: Array.isArray(raw?.extractedSignals)
			? raw!.extractedSignals.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
			: fallback.extractedSignals
	};
}

async function generateTriage(params: {
	attachmentUrl: string;
	name: string;
	mimeType: string;
	sizeBytes: number;
	kind: AttachmentKind;
	note: string;
	source: AttachmentSource;
	contentText: string;
	extractionKind: AttachmentExtraction['extractionKind'];
}): Promise<AttachmentTriageResult> {
	const systemPrompt = `Du er første triage-steg i Resonans.

Målet ditt er ikke å løse hele oppgaven, men å avklare brukerens intensjon for et nytt vedlegg og foreslå de 3 beste neste valgene.

Regler:
- Svar alltid som JSON.
- Vær kort, presis og konkret.
- suggestedActions må være korte knappeetiketter og en naturlig norsk prompt som kan brukes som neste brukerbeskjed.
- Hvis vedlegget er bilde kan du bruke det visuelle innholdet i vurderingen.
- Hvis vedlegget inneholder transkribert eller ekstrahert tekst, skal du bruke det aktivt i vurderingen.
- Hvis vedlegget er lyd eller dokument uten lesbart innhold, må du være tydelig på at du kun bruker filtype, filnavn og brukernotat.
- Ikke lov mer enn du faktisk kan se.

JSON-format:
{
  "summary": "kort oppsummering på norsk",
  "clarificationQuestion": "ett oppfølgingsspørsmål på norsk",
  "suggestedActions": [
    { "id": "kort-id", "label": "Kort knappetekst", "prompt": "Full norsk prompt som kan sendes videre" }
  ],
  "detectedIntent": "kort streng",
  "confidence": "low|medium|high",
  "extractedSignals": ["signal 1", "signal 2"]
}`;

	const attachmentContext = buildAttachmentContext({
		name: params.name,
		mimeType: params.mimeType,
		sizeBytes: params.sizeBytes,
		kind: params.kind,
		note: params.note,
		source: params.source,
		contentText: params.contentText,
		extractionKind: params.extractionKind
	});

	const userText = `Her er vedlegget som nettopp ble lastet opp. Lag et første triage-steg.\n\n${attachmentContext}`;

	const completion = await openai.chat.completions.create({
		model: params.kind === 'image' ? 'gpt-4o' : 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			params.kind === 'image'
				? {
					role: 'user',
					content: [
						{ type: 'text', text: userText },
						{ type: 'image_url', image_url: { url: params.attachmentUrl } }
					]
				}
				: { role: 'user', content: userText }
		],
		temperature: 0.35,
		response_format: { type: 'json_object' },
		max_tokens: 500
	});

	const content = completion.choices[0]?.message?.content;
	return normalizeSuggestedActions(params.kind, params.note, params.name, parseTriageResult(content));
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
			return json({ error: 'Cloudinary not configured' }, { status: 500 });
		}

		const formData = await request.formData();
		const file = formData.get('file');
		const noteValue = formData.get('note');
		const sourceValue = formData.get('source');

		if (!(file instanceof File)) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		const source: AttachmentSource =
			sourceValue === 'camera' || sourceValue === 'file' || sourceValue === 'voice'
				? sourceValue
				: 'file';
		const note = typeof noteValue === 'string' ? noteValue.trim() : '';
		const kind = detectAttachmentKind(file);

		const arrayBuffer = await file.arrayBuffer();
		const buffer = BufferGlobal.from(arrayBuffer);
		const extraction = await extractTextContent(file, buffer, kind);
		const base64 = buffer.toString('base64');
		const dataUri = `data:${file.type || 'application/octet-stream'};base64,${base64}`;

		const uploadOptions = kind === 'image'
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
		const triage = await generateTriage({
			attachmentUrl: uploaded.secure_url,
			name: file.name,
			mimeType: file.type,
			sizeBytes: file.size,
			kind,
			note,
			source,
			contentText: extraction.contentText,
			extractionKind: extraction.extractionKind
		});

		return json({
			success: true,
			attachment: {
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
			},
			triage
		});
	} catch (error) {
		console.error('Attachment triage failed:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Attachment triage failed' },
			{ status: 500 }
		);
	}
};