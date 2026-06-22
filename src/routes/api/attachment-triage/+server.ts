import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { openai } from '$lib/server/openai';
import {
	buildImageSignature,
	computeByteHash,
	runTrackingTriage,
	type TrackingTriageResult
} from '$lib/server/tracking-triage';
import { parseScreenTimeImage } from '$lib/server/integrations/screen-time-parser';
import {
	ingestWeeklyScreenTime,
	ingestDailyScreenTime,
	scrollingMinutes,
	formatScreenTime
} from '$lib/server/integrations/screen-time';
import {
	normalizeAttachmentSource,
	uploadAndExtractAttachment,
	type AttachmentExtraction,
	type AttachmentKind,
	type AttachmentSource
} from '$lib/server/attachment-extract';

interface SuggestedAction {
	id: string;
	label: string;
	prompt: string;
	themeId?: string; // ID til foreslått tema
	themeName?: string; // Navn på foreslått tema
}

interface AttachmentTriageResult {
	summary: string;
	clarificationQuestion: string;
	suggestedActions: SuggestedAction[];
	detectedIntent: string;
	confidence: 'low' | 'medium' | 'high';
	extractedSignals: string[];
	suggestedTheme?: { // Foreslått tema basert på innhold
		themeId: string;
		themeName: string;
		confidence: 'high' | 'medium' | 'low';
	};
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

export const POST: RequestHandler = async ({ request, locals }) => {
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

		const source: AttachmentSource = normalizeAttachmentSource(sourceValue);
		const note = typeof noteValue === 'string' ? noteValue.trim() : '';

		// Delt kjerne: last opp + trekk ut innhold (samme som det slanke endepunktet).
		const { attachment, buffer, extraction } = await uploadAndExtractAttachment(file, note, source);
		const kind = attachment.kind;

		const triage = await generateTriage({
			attachmentUrl: attachment.url,
			name: file.name,
			mimeType: file.type,
			sizeBytes: file.size,
			kind,
			note,
			source,
			contentText: extraction.contentText,
			extractionKind: extraction.extractionKind
		});

		let tracking: TrackingTriageResult | null = null;
		if (kind === 'image') {
			const byteHash = computeByteHash(buffer);
			const imageSignature = await buildImageSignature({
				attachmentUrl: attachment.url,
				note,
				byteHash
			}).catch(() => null);

			const userId = locals.userId;
			if (userId) {
				tracking = await runTrackingTriage(
					{
						userId,
						attachment: {
							url: attachment.url,
							kind,
							note,
							contentText: extraction.contentText,
							source
						},
						triage: {
							summary: triage.summary,
							extractedSignals: triage.extractedSignals,
							detectedIntent: triage.detectedIntent,
							confidence: triage.confidence
						},
						byteHash
					},
					imageSignature
				).catch(() => null);
			}

			if (imageSignature) {
				triage.extractedSignals = [
					...triage.extractedSignals,
					`layout:${imageSignature.layoutPattern ?? 'unknown'}`,
					`markers:${imageSignature.markerDensity ?? 'low'}`
					].slice(0, 8);
			}
		}

		// Skjermtid: kjenn igjen iOS Skjermtid-skjermbilde og lagre direkte ved opplasting,
		// slik at brukeren slipper å «bekrefte»-loope i chatten. Gates på en billig heuristikk
		// fra triage-resultatet så vi ikke kjører ekstra vision på alle bilder.
		const userId = locals.userId;
		if (kind === 'image' && userId) {
			const haystack = `${triage.summary} ${triage.detectedIntent} ${triage.extractedSignals.join(' ')} ${extraction.contentText}`;
			const looksLikeScreenTime = /skjermtid|screen ?time|app ?bruk|app usage|mest brukt|sosialt|produktivitet og finans/i.test(haystack);
			if (looksLikeScreenTime) {
				const parsed = await parseScreenTimeImage(attachment.url).catch(() => null);
				if (parsed && parsed.kind !== 'unknown') {
					const autoRecord = parsed.confidence !== 'low';
					if (parsed.kind === 'weekly') {
						const scroll = formatScreenTime(scrollingMinutes(parsed.weekly.categories));
						const avg = formatScreenTime(parsed.weekly.avgPerDayMinutes);
						if (autoRecord) {
							const res = await ingestWeeklyScreenTime(userId, parsed.weekly).catch(() => null);
							if (res) {
								triage.summary = `✅ Lagret skjermtid for uken som starter ${res.weekStartISO} (${res.days.length} dager). Snitt/dag ${avg}, scrolling ${scroll}.`;
								triage.detectedIntent = 'registrer-skjermtid';
							}
						} else {
							triage.summary = `Dette ser ut som et ukesbilde av skjermtid (snitt/dag ${avg}, scrolling ${scroll}), men jeg er litt usikker. Vil du at jeg registrerer det?`;
						}
					} else if (parsed.kind === 'daily') {
						const dateISO = parsed.dateISO ?? new Date().toISOString().slice(0, 10);
						const total = formatScreenTime(parsed.daily.totalMinutes);
						const scroll = formatScreenTime(scrollingMinutes(parsed.daily.categories));
						if (autoRecord) {
							const ok = await ingestDailyScreenTime(userId, dateISO, { ...parsed.daily, captureType: 'daily' }).catch(() => null);
							if (ok) {
								triage.summary = `✅ Lagret skjermtid for ${dateISO}. Total ${total}, scrolling ${scroll}.`;
								triage.detectedIntent = 'registrer-skjermtid';
							}
						} else {
							triage.summary = `Dette ser ut som et dagsbilde av skjermtid (${dateISO}: total ${total}, scrolling ${scroll}), men jeg er litt usikker. Vil du at jeg registrerer det?`;
						}
					}

					// Sett skjermtid-spesifikke handlinger. «Registrer skjermtid» sender bildet med
					// (chip-handleren videresender attachment.url), så ett trykk lagrer ved lav tillit.
					triage.suggestedActions = [
						...(autoRecord
							? []
							: [{ id: 'screentime-record', label: 'Registrer skjermtid', prompt: 'Registrer denne skjermtiden fra bildet.' }]),
						{ id: 'screentime-open', label: 'Åpne skjermtid', prompt: 'Vis skjermtid-oversikten min og hvordan jeg ligger an mot målene.' },
						{ id: 'screentime-goal', label: 'Sett ukesmål', prompt: 'Jeg vil sette et ukesmål for skjermtid eller scrolling.' }
					].slice(0, 3);
					triage.clarificationQuestion = autoRecord
						? 'Vil du analysere skjermtiden eller sette et mål?'
						: 'Skal jeg registrere skjermtiden fra dette bildet?';
				}
			}
		}

		return json({
			success: true,
			attachment,
			triage,
			tracking
		});
	} catch (error) {
		console.error('Attachment triage failed:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Attachment triage failed' },
			{ status: 500 }
		);
	}
};