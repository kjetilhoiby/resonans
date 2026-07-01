/**
 * Chat-relatert logikk for hjemskjermen.
 *
 * Attachment-triage, sheet-snapshotting, media-gjenbruk,
 * samtale-liste-operasjoner og quick-actions.
 */

import type { AttachmentRef, QuickAction, QuickActionId, MediaHistoryItem } from './home-context';
import type { ChatState } from '$lib/client/chat-state.svelte';

// ── Typer ───────────────────────────────────────────────────────────────

type AttachmentKind = 'image' | 'audio' | 'document' | 'other';
type AttachmentSource = 'camera' | 'file' | 'voice' | 'sheet';

export interface AttachmentTriageResponse {
	attachment: AttachmentRef;
	triage: {
		summary: string;
		clarificationQuestion: string;
		suggestedActions: Array<{ id: string; label: string; prompt: string }>;
		detectedIntent: string;
		confidence: 'low' | 'medium' | 'high';
		extractedSignals: string[];
	};
	tracking?: {
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
	} | null;
}

// ── Quick Actions ──────────────────────────────────────────────────────

export const QUICK_ACTIONS: QuickAction[] = [
	{
		id: 'chat',
		label: 'Samtale',
		icon: 'chat',
		description: 'Start med en fri tanke, et spørsmål eller et behov for retning.',
		placeholder: 'Hva tenker du på?',
		helper: 'Fin start når du bare vil tømme hodet eller få hjelp til å sortere noe.'
	},
	{
		id: 'camera',
		label: 'Kamera',
		icon: 'camera',
		description: 'Fang et bilde av noe som bør registreres eller forstås.',
		placeholder: 'Beskriv bildet, eller lim inn det viktigste du ser i det.',
		helper: 'Tenk skjermtid, kvittering, måling, notat eller en annen visuell observasjon.'
	},
	{
		id: 'voice',
		label: 'Lyd',
		icon: 'wave',
		description: 'Bruk stemmen, eller last opp en video med lyd, når du vil få noe ut raskt uten å formulere deg perfekt.',
		placeholder: 'Skriv stikkord for det du ville sagt høyt.',
		helper: 'Bra for raske tanker, refleksjoner etter noe som nettopp skjedde, eller en spontan idé.'
	},
	{
		id: 'mood',
		label: 'Sjekkin',
		icon: 'checkin',
		description: 'Egenfrekvens: balanse, tanker, følelser og handlinger på 30 sekunder.',
		placeholder: 'Hvordan har du det akkurat nå, og hva tror du påvirker det?',
		helper: 'Korte snapshots som senere kan kobles til tema eller mønster.'
	},
	{
		id: 'file',
		label: 'Fil',
		icon: 'file',
		description: 'Ta inn dokumenter, utsnitt eller annet innhold som bør triageres videre.',
		placeholder: 'Hva inneholder filen, og hva vil du at vi skal gjøre med den?',
		helper: 'Kan være PDF, eksport, skjermdump eller annet materiale du vil rute til riktig tema.'
	}
];

// ── Attachment-triage ──────────────────────────────────────────────────

export async function requestAttachmentTriage(
	file: File,
	note: string,
	source: AttachmentSource
): Promise<AttachmentTriageResponse> {
	const formData = new FormData();
	formData.append('file', file);
	formData.append('note', note);
	formData.append('source', source);
	const response = await fetch('/api/attachment-triage', {
		method: 'POST',
		body: formData
	});
	if (!response.ok) {
		throw new Error('Attachment triage failed');
	}
	return response.json();
}

/**
 * Slank opplasting uten triage: laster kun opp + trekker ut innhold via
 * /api/attachment-extract. Brukes for «pen visning i tråden»-flyten der bildet
 * vises med en valgfri bildetekst, og chatturen selv håndterer konteksten —
 * ingen kald LLM-triage, ingen auto-registrering. (Triage kan fortsatt kjøres
 * på forespørsel via langpress på bildet.)
 */
export async function requestAttachmentUpload(
	file: File,
	note: string,
	source: AttachmentSource
): Promise<AttachmentRef> {
	const formData = new FormData();
	formData.append('file', file);
	formData.append('note', note);
	formData.append('source', source);
	const response = await fetch('/api/attachment-extract', { method: 'POST', body: formData });
	if (!response.ok) {
		throw new Error('Attachment upload failed');
	}
	const data = await response.json();
	return data.attachment as AttachmentRef;
}

export function buildAttachmentTriageText(result: AttachmentTriageResponse['triage']): string {
	return [
		result.summary,
		result.clarificationQuestion,
		result.extractedSignals.length > 0
			? `Mulige signaler: ${result.extractedSignals.join(' · ')}`
			: null
	].filter(Boolean).join('\n\n');
}

export function buildTrackingPrompt(tracking: NonNullable<AttachmentTriageResponse['tracking']>): string {
	const date = tracking.extracted?.date || new Date().toISOString().slice(0, 10);
	const note = tracking.extracted?.note || '';
	const measurements = (tracking.extracted?.measurements || [])
		.map((m) => `${m.key}=${String(m.value)}${m.unit ? ` ${m.unit}` : ''}`)
		.join(', ');
	return [
		`Registrer dette i tracking-serien ${tracking.title || tracking.recordTypeKey || 'ukjent'} (${tracking.seriesId || ''}).`,
		`Dato: ${date}`,
		note ? `Notat: ${note}` : null,
		measurements ? `Målinger: ${measurements}` : null,
		'Bruk record_tracking_event og seriesId fra meldingen.'
	].filter(Boolean).join('\n');
}

/**
 * Presenterer et triage-resultat i chat-tilstanden.
 * Returnerer oppdaterte verdier som HomeScreen setter inn i sin state.
 */
export function presentAttachmentTriage(
	result: AttachmentTriageResponse,
	homeChat: ChatState,
	pendingActionHandlers: Record<string, () => void>,
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>
): void {
	const attachment = result.attachment;
	const triageText = buildAttachmentTriageText(result.triage);
	const chatStateActions: { id: string; label: string }[] = [];
	result.triage.suggestedActions.forEach((action) => {
		const id = action.id || `triage-${action.label}`;
		chatStateActions.push({ id, label: action.label });
		pendingActionHandlers[id] = () => {
			void sendChat(action.prompt, attachment.kind === 'image' ? attachment.url : undefined, attachment);
		};
	});
	let trackingText: string | null = null;
	if (result.tracking?.matched) {
		const conf = result.tracking.confidence || 'low';
		const label = result.tracking.title || result.tracking.recordTypeKey || 'ukjent serie';
		if (result.tracking.autoRecordedEventId) {
			trackingText = `Tracking-match: ${label} (${conf}). Registrering lagret automatisk.`;
		} else if (result.tracking.action === 'confirm') {
			trackingText = `Tracking-match: ${label} (${conf}). Klar for bekreftet registrering.`;
			const trackingId = 'tracking-register';
			chatStateActions.unshift({ id: trackingId, label: 'Registrer i serie' });
			pendingActionHandlers[trackingId] = () => {
				if (!result.tracking) return;
				const prompt = buildTrackingPrompt(result.tracking);
				void sendChat(prompt, attachment.kind === 'image' ? attachment.url : undefined, attachment);
			};
		}
	}
	const assistantText = [triageText, trackingText].filter(Boolean).join('\n\n');
	homeChat.messages = [
		...homeChat.messages,
		{
			id: crypto.randomUUID(),
			role: 'user' as const,
			text: attachment.note,
			starred: false,
			imageUrl: attachment.kind === 'image' ? attachment.url : null,
			attachment: attachment as import('$lib/client/chat-state.svelte').ChatMessage['attachment']
		},
		{
			id: crypto.randomUUID(),
			role: 'assistant' as const,
			text: assistantText,
			starred: false,
			actions: chatStateActions
		}
	];
}

// ── Sheet-snapshot hjelpere ─────────────────────────────────────────────

export function extractSpreadsheetId(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (!trimmed.includes('docs.google.com')) return trimmed;
	return trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? '';
}

export function serializeSheetValues(values: string[][], maxRows = 40, maxCols = 10, maxChars = 6000): string {
	const truncatedRows = values.slice(0, maxRows).map((row) =>
		row
			.slice(0, maxCols)
			.map((cell) => cell.replace(/[\r\n\t]+/g, ' ').trim())
			.join('\t')
	);
	const hasMoreRows = values.length > maxRows;
	const hasMoreCols = values.some((row) => row.length > maxCols);
	const footer = hasMoreRows || hasMoreCols ? '\n\n[data kuttet]' : '';
	const content = `${truncatedRows.join('\n')}${footer}`.trim();
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars).trim()}\n\n[data kuttet]`;
}

export function previewSheetRows(values: string[][], rowCount = 2, colCount = 8): string[] {
	return values.slice(0, rowCount).map((row, index) => {
		const cells = row
			.slice(0, colCount)
			.map((cell) => cell.replace(/[\r\n\t]+/g, ' ').trim())
			.filter((cell) => cell.length > 0);
		return `Rad ${index + 1}: ${cells.join(' | ') || '(tom)'}`;
	});
}

// ── Media-gjenbruk ──────────────────────────────────────────────────────

export async function reuseCameraMedia(item: MediaHistoryItem): Promise<{ preview: string; caption: string }> {
	return { preview: item.url, caption: item.note ?? '' };
}

export async function reuseVoiceMedia(item: MediaHistoryItem): Promise<{ file: File; text: string }> {
	const res = await fetch(item.url);
	const blob = await res.blob();
	return { file: new File([blob], item.name, { type: item.mimeType }), text: item.note ?? '' };
}

export async function reuseFileMedia(item: MediaHistoryItem): Promise<{ file: File; note: string }> {
	const res = await fetch(item.url);
	const blob = await res.blob();
	return { file: new File([blob], item.name, { type: item.mimeType }), note: item.note ?? '' };
}

// ── Dato-formatering ──────────────────────────────────────────────────

export function formatFollowUpDate(iso: string): string {
	return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

// ── Egenfrekvens slot-hjelpere ─────────────────────────────────────────

export function currentSlotFromTime(): 'morning' | 'evening' {
	return new Date().getHours() < 14 ? 'morning' : 'evening';
}

// ── Desktop auto-focus ────────────────────────────────────────────────

export function shouldAutoFocusInput(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(pointer: fine)').matches;
}

// ── Tema-relasjon ──────────────────────────────────────────────────────

function normalizeThemeName(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

export function isRelationshipThemeName(name: string): boolean {
	const normalized = normalizeThemeName(name);
	return /(parforhold|partner|samliv|relasjon|forhold)/.test(normalized);
}
