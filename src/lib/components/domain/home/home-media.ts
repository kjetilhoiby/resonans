/**
 * Kamera-, lyd- og fil-flyt state og handlers for hjemskjermen.
 *
 * Samler all state-deklarering og logikk som tidligere levde i HomeScreen.svelte
 * for de tre media-flytene: kamera, lyd og fil (inkl. Google Sheet snapshot).
 */

import type { AttachmentRef, MediaHistoryItem } from './home-context';
import type { ChatState } from '$lib/client/chat-state.svelte';
import {
	requestAttachmentTriage,
	presentAttachmentTriage,
	extractSpreadsheetId,
	serializeSheetValues,
	previewSheetRows,
	type AttachmentTriageResponse,
} from './home-chat';

// ── Kamera-state ──────────────────────────────────────────────────────

export interface CameraState {
	cameraOpen: boolean;
	cameraFileInput: HTMLInputElement | null;
	cameraSelectedFile: File | null;
	cameraPreview: string | null;
	cameraCaption: string;
	cameraUploading: boolean;
	cameraError: boolean;
	cameraHistory: MediaHistoryItem[];
	cameraHistoryLoading: boolean;
}

export function createCameraState(): CameraState {
	return {
		cameraOpen: false,
		cameraFileInput: null,
		cameraSelectedFile: null,
		cameraPreview: null,
		cameraCaption: '',
		cameraUploading: false,
		cameraError: false,
		cameraHistory: [],
		cameraHistoryLoading: false,
	};
}

export function handleCameraFileSelect(state: CameraState, event: Event): void {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	state.cameraSelectedFile = file;
	const reader = new FileReader();
	reader.onload = (e) => {
		state.cameraPreview = e.target?.result as string;
	};
	reader.readAsDataURL(file);
}

export function closeCameraFlow(
	state: CameraState,
	returnToChatAfterFlow: boolean,
	setChatOpen: (v: boolean) => void,
	setChatInputAutoFocus: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
): void {
	state.cameraOpen = false;
	state.cameraSelectedFile = null;
	state.cameraPreview = null;
	state.cameraCaption = '';
	state.cameraError = false;
	if (returnToChatAfterFlow) {
		setChatOpen(true);
		setChatInputAutoFocus(true);
	}
	setReturnToChatAfterFlow(false);
}

export async function submitCamera(
	state: CameraState,
	homeChat: ChatState,
	pendingActionHandlers: Record<string, () => void>,
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>,
	closeFn: () => void,
	setSelectedQuickAction: (v: 'chat') => void,
	setChatOpen: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
	setChatPrefill: (v: string) => void,
): Promise<void> {
	if (!state.cameraSelectedFile) return;
	state.cameraUploading = true;
	state.cameraError = false;
	try {
		const result = await requestAttachmentTriage(state.cameraSelectedFile, state.cameraCaption.trim(), 'camera');
		closeFn();
		presentAttachmentTriage(result, homeChat, pendingActionHandlers, sendChat);
		setSelectedQuickAction('chat');
		setChatOpen(true);
		setReturnToChatAfterFlow(false);
		setChatPrefill('');
	} catch {
		state.cameraError = true;
	} finally {
		state.cameraUploading = false;
	}
}

export async function reuseCameraMedia(state: CameraState, item: MediaHistoryItem): Promise<void> {
	state.cameraPreview = item.url;
	state.cameraCaption = item.note ?? '';
}

// ── Lyd-state ──────────────────────────────────────────────────────────

export interface VoiceState {
	voiceOpen: boolean;
	voiceText: string;
	voiceFileInput: HTMLInputElement | null;
	voiceSelectedFile: File | null;
	voiceUploading: boolean;
	voiceError: boolean;
	voiceHistory: MediaHistoryItem[];
	voiceHistoryLoading: boolean;
}

export function createVoiceState(): VoiceState {
	return {
		voiceOpen: false,
		voiceText: '',
		voiceFileInput: null,
		voiceSelectedFile: null,
		voiceUploading: false,
		voiceError: false,
		voiceHistory: [],
		voiceHistoryLoading: false,
	};
}

export function handleVoiceFileSelect(state: VoiceState, event: Event): void {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	state.voiceSelectedFile = file;
	state.voiceError = false;
}

export function closeVoiceFlow(
	state: VoiceState,
	returnToChatAfterFlow: boolean,
	setChatOpen: (v: boolean) => void,
	setChatInputAutoFocus: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
): void {
	state.voiceOpen = false;
	state.voiceText = '';
	state.voiceSelectedFile = null;
	state.voiceError = false;
	if (state.voiceFileInput) state.voiceFileInput.value = '';
	if (returnToChatAfterFlow) {
		setChatOpen(true);
		setChatInputAutoFocus(true);
	}
	setReturnToChatAfterFlow(false);
}

export async function submitVoice(
	state: VoiceState,
	homeChat: ChatState,
	pendingActionHandlers: Record<string, () => void>,
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>,
	closeFn: () => void,
	setSelectedQuickAction: (v: 'chat') => void,
	setChatOpen: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
	setChatPrefill: (v: string) => void,
): Promise<void> {
	if (!state.voiceSelectedFile) return;
	state.voiceUploading = true;
	state.voiceError = false;
	try {
		const result = await requestAttachmentTriage(state.voiceSelectedFile, state.voiceText.trim(), 'voice');
		closeFn();
		presentAttachmentTriage(result, homeChat, pendingActionHandlers, sendChat);
		setSelectedQuickAction('chat');
		setChatOpen(true);
		setReturnToChatAfterFlow(false);
		setChatPrefill('');
	} catch {
		state.voiceError = true;
	} finally {
		state.voiceUploading = false;
	}
}

export async function reuseVoiceMedia(state: VoiceState, item: MediaHistoryItem): Promise<void> {
	try {
		const res = await fetch(item.url);
		const blob = await res.blob();
		state.voiceSelectedFile = new File([blob], item.name, { type: item.mimeType });
		state.voiceText = item.note ?? '';
	} catch (err) {
		console.error('Error reusing voice media:', err);
	}
}

// ── Fil-state ──────────────────────────────────────────────────────────

export interface FileFlowState {
	fileFlowOpen: boolean;
	fileFlowInput: HTMLInputElement | null;
	fileFlowSelected: File | null;
	fileFlowMode: 'local' | 'sheet';
	fileFlowNote: string;
	fileFlowUploading: boolean;
	fileFlowError: boolean;
	sheetFlowUrl: string;
	sheetFlowRange: string;
	sheetFlowUploading: boolean;
	sheetFlowError: string;
	fileHistory: MediaHistoryItem[];
	fileHistoryLoading: boolean;
}

export function createFileFlowState(): FileFlowState {
	return {
		fileFlowOpen: false,
		fileFlowInput: null,
		fileFlowSelected: null,
		fileFlowMode: 'local',
		fileFlowNote: '',
		fileFlowUploading: false,
		fileFlowError: false,
		sheetFlowUrl: '',
		sheetFlowRange: '',
		sheetFlowUploading: false,
		sheetFlowError: '',
		fileHistory: [],
		fileHistoryLoading: false,
	};
}

export function handleFileFlowSelect(state: FileFlowState, event: Event): void {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) state.fileFlowSelected = file;
}

export function closeFileFlow(
	state: FileFlowState,
	returnToChatAfterFlow: boolean,
	setChatOpen: (v: boolean) => void,
	setChatInputAutoFocus: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
): void {
	state.fileFlowOpen = false;
	state.fileFlowSelected = null;
	state.fileFlowMode = 'local';
	state.fileFlowNote = '';
	state.fileFlowError = false;
	state.sheetFlowUrl = '';
	state.sheetFlowRange = '';
	state.sheetFlowError = '';
	if (returnToChatAfterFlow) {
		setChatOpen(true);
		setChatInputAutoFocus(true);
	}
	setReturnToChatAfterFlow(false);
}

export function submitFile(
	state: FileFlowState,
	homeChat: ChatState,
	pendingActionHandlers: Record<string, () => void>,
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>,
	closeFn: () => void,
	setSelectedQuickAction: (v: 'chat') => void,
	setChatOpen: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
	setChatPrefill: (v: string) => void,
): void {
	if (!state.fileFlowSelected) return;
	const selectedFile = state.fileFlowSelected;
	const note = state.fileFlowNote.trim();
	state.fileFlowUploading = true;
	state.fileFlowError = false;
	requestAttachmentTriage(selectedFile, note, 'file')
		.then((result) => {
			closeFn();
			presentAttachmentTriage(result, homeChat, pendingActionHandlers, sendChat);
			setSelectedQuickAction('chat');
			setChatOpen(true);
			setReturnToChatAfterFlow(false);
			setChatPrefill('');
		})
		.catch(() => {
			state.fileFlowError = true;
		})
		.finally(() => {
			state.fileFlowUploading = false;
		});
}

export async function submitSheetSnapshot(
	state: FileFlowState,
	homeChat: ChatState,
	pendingActionHandlers: Record<string, () => void>,
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>,
	closeFn: () => void,
	setSelectedQuickAction: (v: 'chat') => void,
	setChatOpen: (v: boolean) => void,
	setReturnToChatAfterFlow: (v: boolean) => void,
	setChatPrefill: (v: string) => void,
): Promise<void> {
	state.sheetFlowError = '';
	const spreadsheetId = extractSpreadsheetId(state.sheetFlowUrl);
	if (!spreadsheetId) {
		state.sheetFlowError = 'Legg inn gyldig Google Sheet-lenke eller spreadsheetId.';
		return;
	}
	state.sheetFlowUploading = true;
	try {
		const params = new URLSearchParams({ spreadsheetId });
		if (state.sheetFlowRange.trim()) params.set('range', state.sheetFlowRange.trim());
		const [response, metaResponse] = await Promise.all([
			fetch(`/api/sensors/google-sheets/read?${params.toString()}`),
			fetch(`/api/sensors/google-sheets/read?spreadsheetId=${encodeURIComponent(spreadsheetId)}&meta=true`),
		]);
		const payload = await response.json();
		const metaPayload = metaResponse.ok ? await metaResponse.json() : null;
		if (!response.ok) throw new Error(payload?.error || 'Kunne ikke lese regnearkdata');
		const values: string[][] = Array.isArray(payload.values) ? payload.values : [];
		const dataText = serializeSheetValues(values);
		const rangeText = payload.range || state.sheetFlowRange.trim() || 'A1:ZZ10000';
		const sheetTitle =
			typeof metaPayload?.title === 'string' && metaPayload.title.trim().length > 0
				? metaPayload.title.trim()
				: 'Google Sheet';
		const rowPreview = previewSheetRows(values, 2, 8);
		const rowPreviewText = rowPreview.length > 0 ? rowPreview.join('\n') : 'Ingen rader funnet i valgt range.';
		const note = state.fileFlowNote.trim();
		const attachment: AttachmentRef = {
			url: state.sheetFlowUrl.trim() || `google-sheet://${spreadsheetId}`,
			kind: 'document',
			name: `${sheetTitle} (${rangeText})`,
			mimeType: 'application/vnd.google-apps.spreadsheet',
			note,
			source: 'sheet',
			contentText: `Tittel: ${sheetTitle}\nRange: ${rangeText}\n\nForhåndsvisning (2 første rader):\n${rowPreviewText}\n\nUtdrag:\n${dataText}`,
			extractionKind: 'sheet_snapshot',
		};
		const promptContext = `Regnearktittel: ${sheetTitle}. Range: ${rangeText}. Forhåndsvisning: ${rowPreviewText}.${note ? ` Brukernotat: ${note}` : ''}`;
		const triage: AttachmentTriageResponse = {
			attachment,
			triage: {
				summary: `Jeg hentet ${payload.rowCount ?? values.length} rader fra «${sheetTitle}» (${rangeText}). Første rader: ${rowPreviewText}`,
				clarificationQuestion: 'Hva vil du at vi skal gjøre med dette regnearkutdraget?',
				suggestedActions: [
					{ id: 'sheet-summary', label: 'Oppsummer nøkkelpunkter', prompt: `Oppsummer de viktigste innsiktene fra dette regnearkutdraget. ${promptContext}` },
					{ id: 'sheet-patterns', label: 'Finn mønstre', prompt: `Finn mønstre, avvik og ting jeg bør reagere på i dette regnearkutdraget. ${promptContext}` },
					{ id: 'sheet-theme', label: 'Knytt til tema', prompt: `Hvilket tema passer dette regnearkutdraget best under, og hva er anbefalt neste steg? ${promptContext}` },
				],
				detectedIntent: 'analyse-sheet-snapshot',
				confidence: 'high',
				extractedSignals: [
					`Tittel: ${sheetTitle}`,
					`Rader: ${payload.rowCount ?? values.length}`,
					`Kolonner: ${payload.colCount ?? (values[0]?.length ?? 0)}`,
					`Range: ${rangeText}`,
					...rowPreview,
				],
			},
		};
		closeFn();
		presentAttachmentTriage(triage, homeChat, pendingActionHandlers, sendChat);
		setSelectedQuickAction('chat');
		setChatOpen(true);
		setReturnToChatAfterFlow(false);
		setChatPrefill('');
	} catch (error) {
		state.sheetFlowError = error instanceof Error ? error.message : 'Noe gikk galt. Prøv igjen.';
	} finally {
		state.sheetFlowUploading = false;
	}
}

export async function reuseFileMedia(state: FileFlowState, item: MediaHistoryItem): Promise<void> {
	try {
		const res = await fetch(item.url);
		const blob = await res.blob();
		state.fileFlowSelected = new File([blob], item.name, { type: item.mimeType });
		state.fileFlowNote = item.note ?? '';
	} catch (err) {
		console.error('Error reusing file media:', err);
	}
}
