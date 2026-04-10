import { openai } from '$lib/server/openai';
import { db } from '$lib/db';
import { trackingSeriesExamples } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { listTrackingSeriesForUser, recordTrackingEvent, type ImageSignatureInput } from '$lib/server/tracking-series';

export interface TrackingTriageInput {
	userId: string;
	attachment: {
		url: string;
		kind: 'image' | 'audio' | 'document' | 'other';
		note?: string;
		contentText?: string;
		source?: string;
	};
	triage: {
		summary: string;
		extractedSignals: string[];
		detectedIntent: string;
		confidence: 'low' | 'medium' | 'high';
	};
	byteHash?: string;
}

export interface TrackingTriageResult {
	matched: boolean;
	seriesId?: string;
	title?: string;
	recordTypeKey?: string;
	confidence?: 'low' | 'medium' | 'high';
	action?: 'auto_register' | 'confirm' | 'none';
	reasoning?: string;
	extracted?: {
		date?: string;
		note?: string;
		measurements?: Array<{ key: string; value: number | string | boolean; unit?: string }>;
	};
	autoRecordedEventId?: string;
}

export function computeByteHash(buffer: Buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

export async function buildImageSignature(params: {
	attachmentUrl: string;
	note?: string;
	byteHash?: string;
}): Promise<ImageSignatureInput> {
	const prompt = `Analyser bildet og gi en strukturell signatur for matching av lignende skjermbilder (f.eks. kalendere med markerte dager).

Svar KUN JSON:
{
  "layoutPattern": "calendar_grid|timeline|list|chart|card_grid|unknown",
  "dominantColors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "markerDensity": "low|medium|high",
  "structuralTokens": ["token1", "token2"],
  "sparseSemantics": true
}

Notat fra bruker: ${params.note || '(tomt)'}`;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: prompt },
					{ type: 'image_url', image_url: { url: params.attachmentUrl } }
				]
			}
		],
		temperature: 0.1,
		response_format: { type: 'json_object' },
		max_tokens: 260
	});

	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as Record<string, unknown>;
	} catch {
		parsed = {};
	}

	const colors = Array.isArray(parsed.dominantColors)
		? parsed.dominantColors.filter((c): c is string => typeof c === 'string').slice(0, 5)
		: [];
	const tokens = Array.isArray(parsed.structuralTokens)
		? parsed.structuralTokens.filter((t): t is string => typeof t === 'string').slice(0, 8)
		: [];

	return {
		version: 1,
		byteHash: params.byteHash,
		layoutPattern:
			typeof parsed.layoutPattern === 'string' && parsed.layoutPattern.trim().length > 0
				? parsed.layoutPattern.trim()
				: 'unknown',
		dominantColors: colors,
		markerDensity:
			parsed.markerDensity === 'low' || parsed.markerDensity === 'medium' || parsed.markerDensity === 'high'
				? parsed.markerDensity
				: 'low',
		structuralTokens: tokens,
		sparseSemantics: parsed.sparseSemantics === true
	};
}

export async function runTrackingTriage(input: TrackingTriageInput, imageSignature?: ImageSignatureInput | null): Promise<TrackingTriageResult | null> {
	if (input.attachment.kind !== 'image') return null;

	const seriesList = await listTrackingSeriesForUser(input.userId);
	if (seriesList.length === 0) return null;

	const seriesWithExamples = await Promise.all(
		seriesList.slice(0, 12).map(async (series) => {
			const recordTypeValue = Array.isArray(series.recordType) ? series.recordType[0] : series.recordType;
			const recordTypeKey =
				recordTypeValue && typeof recordTypeValue === 'object' && typeof (recordTypeValue as { key?: unknown }).key === 'string'
					? ((recordTypeValue as { key: string }).key)
					: 'tracking';

			const examples = await db.query.trackingSeriesExamples.findMany({
				where: and(eq(trackingSeriesExamples.trackingSeriesId, series.id), eq(trackingSeriesExamples.confirmed, true)),
				orderBy: [desc(trackingSeriesExamples.createdAt)],
				limit: 3
			});
			return {
				id: series.id,
				title: series.title,
				autoRegister: series.autoRegister,
				confirmationPolicy: series.confirmationPolicy,
				recordTypeKey,
				captureHints: series.captureHints,
				signatureProfile: series.signatureProfile,
				examples: examples.map((e) => ({
					signature: e.imageSignature,
					parsedPayload: e.parsedPayload
				}))
			};
		})
	);

	const prompt = `Du matcher et nytt bilde mot eksisterende tracking-serier for en bruker.

Regler:
- Velg bare en serie hvis match er tydelig.
- Returner confidence low|medium|high.
- action=auto_register kun når confidence=high og serien har autoRegister=true.
- Hvis ingen passer, returner matched=false.
- Hvis mulig: trekk ut dato og målinger (f.eks. reps/minutter/antall markerte dager).

Svar KUN JSON:
{
  "matched": true,
  "seriesId": "uuid",
  "confidence": "low|medium|high",
  "reasoning": "kort forklaring",
  "action": "auto_register|confirm|none",
  "extracted": {
    "date": "YYYY-MM-DD",
    "note": "kort",
    "measurements": [{ "key": "reps", "value": 5, "unit": "stk" }]
  }
}`;

	const context = {
		incoming: {
			triage: input.triage,
			note: input.attachment.note || null,
			contentText: input.attachment.contentText || null,
			imageSignature: imageSignature || null
		},
		series: seriesWithExamples
	};

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: prompt },
			{
				role: 'user',
				content: JSON.stringify(context)
			}
		],
		temperature: 0.2,
		response_format: { type: 'json_object' },
		max_tokens: 500
	});

	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as Record<string, unknown>;
	} catch {
		return null;
	}

	const matched = parsed.matched === true;
	if (!matched) return { matched: false, action: 'none' };

	const seriesId = typeof parsed.seriesId === 'string' ? parsed.seriesId : undefined;
	if (!seriesId) return { matched: false, action: 'none' };

	const matchedSeries = seriesWithExamples.find((s) => s.id === seriesId);
	if (!matchedSeries) return { matched: false, action: 'none' };

	const confidence =
		parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
			? parsed.confidence
			: 'low';

	const extractedRaw = typeof parsed.extracted === 'object' && parsed.extracted
		? (parsed.extracted as Record<string, unknown>)
		: {};

	const measurements = Array.isArray(extractedRaw.measurements)
		? extractedRaw.measurements
			.filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
			.map((m) => ({
				key: typeof m.key === 'string' ? m.key : 'count',
				value:
					typeof m.value === 'number' || typeof m.value === 'string' || typeof m.value === 'boolean'
						? m.value
						: 1,
				unit: typeof m.unit === 'string' ? m.unit : undefined
			}))
		: [];

	const extractedDate = typeof extractedRaw.date === 'string' ? extractedRaw.date : new Date().toISOString().slice(0, 10);
	const extractedNote = typeof extractedRaw.note === 'string' ? extractedRaw.note : input.attachment.note || input.triage.summary;

	const requestedAction = parsed.action === 'auto_register' || parsed.action === 'confirm' || parsed.action === 'none'
		? parsed.action
		: 'confirm';

	let action: 'auto_register' | 'confirm' | 'none' = requestedAction;
	if (!matchedSeries.autoRegister && action === 'auto_register') action = 'confirm';
	if (confidence !== 'high' && action === 'auto_register') action = 'confirm';

	let autoRecordedEventId: string | undefined;
	if (action === 'auto_register') {
		const saved = await recordTrackingEvent({
			userId: input.userId,
			seriesId: matchedSeries.id,
			date: extractedDate,
			note: extractedNote,
			measurements,
			sourceImageUrl: input.attachment.url,
			imageSignature: imageSignature || undefined,
			metadata: {
				trackingTriageConfidence: confidence,
				trackingTriageReasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined
			}
		});
		if (saved.success && saved.event?.id) {
			autoRecordedEventId = saved.event.id;
		}
	}

	return {
		matched: true,
		seriesId: matchedSeries.id,
		title: matchedSeries.title,
		recordTypeKey: matchedSeries.recordTypeKey,
		confidence,
		action,
		reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
		extracted: {
			date: extractedDate,
			note: extractedNote,
			measurements
		},
		autoRecordedEventId
	};
}
