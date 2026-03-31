<!--
  HomeScreen — fire-sone hjemskjerm.

  Layout: 10 / 25 / 30 / 35  (tittel / widgets / tema / input)
  Ingen tab-bar, ingen overlays. Soner animerer til fullskjerm ved tap.

  Props:
    themes    aktive temaer fra DB (for tema-grid)
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import WidgetCircle from '../ui/WidgetCircle.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import WidgetConfigSheet from '../ui/WidgetConfigSheet.svelte';
	import ScreenTitle from '../ui/ScreenTitle.svelte';
	import Icon from '../ui/Icon.svelte';
	import ChatInput from '../ui/ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import ChecklistWidget, { type Checklist } from '../composed/ChecklistWidget.svelte';
	import ChecklistSheet from '../ui/ChecklistSheet.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { prefetchDashboard } from '$lib/client/dashboard-cache';
	import { resolveThemeDashboardKind, type DashboardKind } from '$lib/domain/theme-dashboard-registry';

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		themes: Theme[];
	}

	type QuickActionId = 'chat' | 'camera' | 'voice' | 'mood' | 'file';
	type QuickActionIcon = 'chat' | 'camera' | 'wave' | 'checkin' | 'file';

	interface QuickAction {
		id: QuickActionId;
		label: string;
		icon: QuickActionIcon;
		description: string;
		placeholder: string;
		helper: string;
	}

	type AttachmentKind = 'image' | 'audio' | 'document' | 'other';
	type AttachmentSource = 'camera' | 'file' | 'voice' | 'sheet';

	interface AttachmentRef {
		url: string;
		publicId?: string;
		kind: AttachmentKind;
		name: string;
		mimeType: string;
		note: string;
		source: AttachmentSource;
		sizeBytes?: number;
		contentText?: string;
		extractionKind?: string;
	}

	interface TriageSuggestion {
		id: string;
		label: string;
		prompt: string;
	}

	interface ChatAction {
		label: string;
		onclick: () => void;
	}

	interface ChatMessage {
		role: 'user' | 'assistant';
		text: string;
		imageUrl?: string;
		attachment?: AttachmentRef;
		actions?: ChatAction[];
	}

	let { themes }: Props = $props();

	// -- Sensor-data (oppdateres fra API ved mount) --
	interface SensorSummary {
		weight: { current: number | null; unit: string; delta: number; sparkline: number[] };
		sleep: { current: number | null; unit: string; sparkline: number[] };
		steps: { current: number | null; unit: string; sparkline: number[] };
		running: { weekKm: number; unit: string; sparkline: number[] };
		spending: { current: number; unit: string; delta: number; sparkline: number[] };
	}

	let sensorSummary = $state<SensorSummary | null>(null);

	// -- Pinned user-widgets fra DB --
	interface UserWidget {
		id: string;
		title: string;
		unit: string;
		color: string;
		pinned: boolean;
		metricType: string;
		goal: number | null;
		thresholdWarn: number | null;
		thresholdSuccess: number | null;
	}
	let pinnedWidgets = $state<UserWidget[]>([]);
	let widgetsLoading = $state(true);
	let configWidget = $state<UserWidget | null>(null);

	// -- Sjekklister --
	let activeChecklists = $state<Checklist[]>([]);
	let openChecklist = $state<Checklist | null>(null);

	async function fetchChecklists() {
		try {
			const res = await fetch('/api/checklists?active=true');
			if (res.ok) activeChecklists = await res.json();
		} catch { /* stille */ }
	}

	function getDashboardKindForTheme(theme: Theme): DashboardKind | null {
		return resolveThemeDashboardKind(theme.name);
	}

	function scheduleDashboardPrefetch() {
		const prefetchTargets = themes
			.slice(0, 4)
			.map((theme) => ({ themeId: theme.id, kind: getDashboardKindForTheme(theme) }))
			.filter((item): item is { themeId: string; kind: DashboardKind } => item.kind !== null);

		if (prefetchTargets.length === 0 || typeof window === 'undefined') return () => {};
		const browserWindow = window;

		const runPrefetch = () => {
			for (const target of prefetchTargets) {
				void prefetchDashboard(target.themeId, target.kind);
			}
		};

		if ('requestIdleCallback' in browserWindow) {
			const idleId = browserWindow.requestIdleCallback(runPrefetch, { timeout: 1800 });
			return () => browserWindow.cancelIdleCallback(idleId);
		}

		const timeoutId = globalThis.setTimeout(runPrefetch, 350);
		return () => globalThis.clearTimeout(timeoutId);
	}

	onMount(() => {
		let cleanupPrefetch = () => {};

		void (async () => {
			try {
				const [summaryRes, widgetsRes] = await Promise.all([
					fetch('/api/sensor-summary'),
					fetch('/api/user-widgets?pinned=true')
				]);
				if (summaryRes.ok) sensorSummary = await summaryRes.json();
				if (widgetsRes.ok) pinnedWidgets = await widgetsRes.json();
			} catch {
				// Stille feil — fallback til mock-data
			} finally {
				widgetsLoading = false;
			}

			await fetchChecklists();
			cleanupPrefetch = scheduleDashboardPrefetch();

			if ($page.url.searchParams.get('chat') === '1') {
				openChat();
			}
		})();

		return () => {
			cleanupPrefetch();
		};
	});

	// -- Widgets (live eller mock) --
	const WIDGETS = $derived([
		{
			label: 'Vekt',
			sensorType: 'weight' as const,
			val: sensorSummary?.weight.current != null
				? String(sensorSummary.weight.current)
				: '–',
			unit: 'kg',
			color: '#e07070',
			delta: sensorSummary?.weight.delta
				? `${sensorSummary.weight.delta > 0 ? '+' : ''}${sensorSummary.weight.delta} kg`
				: '',
			pct: sensorSummary?.weight.current != null
				? Math.max(0, Math.min(100, Math.round((1 - (sensorSummary.weight.current - 88) / 88) * 100)))
				: 68,
		},
		{
			label: 'Søvn',
			sensorType: 'sleep' as const,
			val: sensorSummary?.sleep.current != null
				? String(sensorSummary.sleep.current)
				: '–',
			unit: 'h',
			color: '#5fa0a0',
			delta: '',
			pct: sensorSummary?.sleep.current != null
				? Math.min(100, Math.round((sensorSummary.sleep.current / 7.5) * 100))
				: 84,
		},
		{
			label: 'Løping',
			sensorType: 'running' as const,
			val: sensorSummary
				? String(sensorSummary.running.weekKm)
				: '–',
			unit: 'km',
			color: '#7c8ef5',
			delta: '',
			pct: sensorSummary
				? Math.min(100, Math.round((sensorSummary.running.weekKm / 30) * 100))
				: 55,
			isRelation: false,
		},
		{
			label: 'Økonomi',
			sensorType: 'spending' as const,
			val: sensorSummary?.spending.current
				? `${Math.round(sensorSummary.spending.current / 1000)}k`
				: '–',
			unit: 'kr',
			color: '#f0b429',
			delta: sensorSummary?.spending.delta
				? `${sensorSummary.spending.delta > 0 ? '+' : ''}${Math.round(sensorSummary.spending.delta / 1000)}k`
				: '',
			pct: sensorSummary?.spending.current
				? Math.max(0, Math.min(100, Math.round((1 - sensorSummary.spending.current / 25000) * 100)))
				: 72,
		},
	]);

	// -- Chat-sone --
	let chatOpen = $state(false);
	let chatPrefill = $state('');
	let chatMessages = $state<ChatMessage[]>([]);
	let chatLoading = $state(false);
	let currentConversationId = $state<string | null>(null);
	let latestClosedConversationId = $state<string | null>(null);
	let createdThemeLink = $state<{ id: string; name: string; emoji?: string | null } | null>(null);
	let launchingThemeId = $state<string | null>(null);

	// ── Kamera-flyt ────────────────────────────────────────────────────────────
	let cameraOpen = $state(false);
	let cameraFileInput = $state<HTMLInputElement | null>(null);
	let cameraSelectedFile = $state<File | null>(null);
	let cameraPreview = $state<string | null>(null);
	let cameraCaption = $state('');
	let cameraUploading = $state(false);
	let cameraError = $state(false);

	// ── Lyd-flyt ───────────────────────────────────────────────────────────────
	let voiceOpen = $state(false);
	let voiceText = $state('');
	let voiceFileInput = $state<HTMLInputElement | null>(null);
	let voiceSelectedFile = $state<File | null>(null);
	let voiceUploading = $state(false);
	let voiceError = $state(false);

	// ── Sjekkin-flyt ──────────────────────────────────────────────────────────
	let moodOpen = $state(false);
	let moodSlider = $state(50);
	let moodFactors = $state<string[]>([]);
	let moodNote = $state('');
	const MOOD_FACTORS = [
		{ id: 'søvn',       label: 'Søvn',      icon: '💤' },
		{ id: 'trening',    label: 'Trening',   icon: '🏃' },
		{ id: 'mat',        label: 'Mat',       icon: '🥗' },
		{ id: 'jobb',       label: 'Jobb',      icon: '💼' },
		{ id: 'familie',    label: 'Familie',   icon: '🧑‍👧' },
		{ id: 'sosialt',    label: 'Sosialt',   icon: '👥' },
		{ id: 'vær',        label: 'Vær',      icon: '☀️' },
		{ id: 'økonomi',    label: 'Økonomi',  icon: '💸' },
		{ id: 'helse',      label: 'Helse',     icon: '🩺' },
		{ id: 'kreativitet', label: 'Kreativitet', icon: '🎨' },
		{ id: 'tid-alene',  label: 'Tid alene', icon: '🧘' },
		{ id: 'natur',      label: 'Natur',     icon: '🌿' },
	];
	const moodLabel = $derived(
		moodSlider < 20  ? 'Veldig lav' :
		moodSlider < 40  ? 'Lav' :
		moodSlider < 60  ? 'OK' :
		moodSlider < 80  ? 'Bra' : 'Strålende'
	);
	const moodEmoji = $derived(
		moodSlider < 20  ? '😔' :
		moodSlider < 40  ? '😐' :
		moodSlider < 60  ? '🙂' :
		moodSlider < 80  ? '😊' : '🤩'
	);
	const moodColor = $derived(
		moodSlider < 20  ? '#e07070' :
		moodSlider < 40  ? '#f0b429' :
		moodSlider < 60  ? '#aaa' :
		moodSlider < 80  ? '#82c882' : '#7c8ef5'
	);

	// ── Fil-flyt ───────────────────────────────────────────────────────────────
	let fileFlowOpen = $state(false);
	let fileFlowInput = $state<HTMLInputElement | null>(null);
	let fileFlowSelected = $state<File | null>(null);
	let fileFlowMode = $state<'local' | 'sheet'>('local');
	let fileFlowNote = $state('');
	let fileFlowUploading = $state(false);
	let fileFlowError = $state(false);
	let sheetFlowUrl = $state('');
	let sheetFlowRange = $state('');
	let sheetFlowUploading = $state(false);
	let sheetFlowError = $state('');

	const QUICK_ACTIONS: QuickAction[] = [
		{
			id: 'chat',
			label: 'Prat',
			icon: 'chat',
			description: 'Start med en fri tanke, et spørsmål eller et behov for retning.',
			placeholder: 'Hva vil du tenke høyt om akkurat nå?',
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
			description: 'Bruk stemmen når du vil få noe ut raskt uten å formulere deg perfekt.',
			placeholder: 'Skriv stikkord for det du ville sagt høyt.',
			helper: 'Bra for raske tanker, refleksjoner etter noe som nettopp skjedde, eller en spontan idé.'
		},
		{
			id: 'mood',
			label: 'Sjekkin',
			icon: 'checkin',
			description: 'Registrer dagsform, energi eller følelsen du står i akkurat nå.',
			placeholder: 'Hvordan har du det akkurat nå, og hva tror du påvirker det?',
			helper: 'Fint for korte emosjonelle snapshots som senere kan kobles til tema eller mønster.'
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
	let selectedQuickAction = $state<QuickActionId>('chat');
	const activeQuickAction = $derived(
		QUICK_ACTIONS.find((action) => action.id === selectedQuickAction) ?? QUICK_ACTIONS[0]
	);
	const hasHomeDraft = $derived(chatPrefill.trim().length > 0);

	function openChat(prefill = '', actionId: QuickActionId = selectedQuickAction) {
		selectedQuickAction = actionId;
		chatPrefill = prefill;
		chatOpen = true;
	}

	function startQuickAction(action: QuickAction) {
		chatMessages = [];
		chatPrefill = '';
		createdThemeLink = null;
		currentConversationId = null;
		if (action.id === 'chat') {
			openChat('', 'chat');
		} else if (action.id === 'camera') {
			cameraOpen = true;
		} else if (action.id === 'voice') {
			voiceOpen = true;
		} else if (action.id === 'mood') {
			moodOpen = true;
		} else if (action.id === 'file') {
			fileFlowOpen = true;
		}
	}

	// ── Kamera-flyt ─────────────────────────────────────────────────────────────
	function closeCameraFlow() {
		cameraOpen = false;
		cameraSelectedFile = null;
		cameraPreview = null;
		cameraCaption = '';
		cameraError = false;
	}

	function handleCameraFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		cameraSelectedFile = file;
		const reader = new FileReader();
		reader.onload = (e) => { cameraPreview = e.target?.result as string; };
		reader.readAsDataURL(file);
	}

	interface AttachmentTriageResponse {
		attachment: AttachmentRef;
		triage: {
			summary: string;
			clarificationQuestion: string;
			suggestedActions: TriageSuggestion[];
			detectedIntent: string;
			confidence: 'low' | 'medium' | 'high';
			extractedSignals: string[];
		};
	}

	async function requestAttachmentTriage(
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

	function buildAttachmentTriageText(result: AttachmentTriageResponse['triage']) {
		return [
			result.summary,
			result.clarificationQuestion,
			result.extractedSignals.length > 0
				? `Mulige signaler: ${result.extractedSignals.join(' · ')}`
				: null
		].filter(Boolean).join('\n\n');
	}

	function presentAttachmentTriage(result: AttachmentTriageResponse) {
		const attachment = result.attachment;
		const triageText = buildAttachmentTriageText(result.triage);
		const actions = result.triage.suggestedActions.map((action) => ({
			label: action.label,
			onclick: () => {
				void sendChat(action.prompt, attachment.kind === 'image' ? attachment.url : undefined, attachment);
			}
		}));

		selectedQuickAction = 'chat';
		chatOpen = true;
		chatPrefill = '';
		chatMessages = [
			...chatMessages,
			{
				role: 'user',
				text: attachment.note,
				imageUrl: attachment.kind === 'image' ? attachment.url : undefined,
				attachment
			},
			{
				role: 'assistant',
				text: triageText,
				actions
			}
		];
	}

	async function submitCamera() {
		if (!cameraSelectedFile) return;
		cameraUploading = true;
		cameraError = false;
		try {
			const result = await requestAttachmentTriage(cameraSelectedFile, cameraCaption.trim(), 'camera');
			closeCameraFlow();
			presentAttachmentTriage(result);
		} catch {
			cameraError = true;
		} finally {
			cameraUploading = false;
		}
	}

	// ── Lyd-flyt ─────────────────────────────────────────────────────────────────
	function closeVoiceFlow() {
		voiceOpen = false;
		voiceText = '';
		voiceSelectedFile = null;
		voiceError = false;
		if (voiceFileInput) {
			voiceFileInput.value = '';
		}
	}

	function handleVoiceFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		voiceSelectedFile = file;
		voiceError = false;
	}

	async function submitVoice() {
		if (!voiceSelectedFile) return;
		voiceUploading = true;
		voiceError = false;
		try {
			const result = await requestAttachmentTriage(voiceSelectedFile, voiceText.trim(), 'voice');
			closeVoiceFlow();
			presentAttachmentTriage(result);
		} catch {
			voiceError = true;
		} finally {
			voiceUploading = false;
		}
	}

	// ── Sjekkin-flyt ─────────────────────────────────────────────────────────────
	function closeMoodFlow() { moodOpen = false; moodSlider = 50; moodFactors = []; moodNote = ''; }

	function toggleFactor(id: string) {
		if (moodFactors.includes(id)) {
			moodFactors = moodFactors.filter(f => f !== id);
		} else {
			moodFactors = [...moodFactors, id];
		}
	}

	function submitMood() {
		const factors = moodFactors
			.map(id => MOOD_FACTORS.find(f => f.id === id))
			.filter(Boolean)
			.map(f => `${f!.icon} ${f!.label}`)
			.join(', ');
		const note = moodNote.trim();
		const msg = [
			`Sjekkin: ${moodEmoji} ${moodLabel} (${moodSlider}/100)`,
			factors ? `Påvirket av: ${factors}` : null,
			note || null,
		].filter(Boolean).join('\n');
		closeMoodFlow();
		chatOpen = true;
		sendChat(msg);
	}

	// ── Fil-flyt ──────────────────────────────────────────────────────────────────
	function closeFileFlow() {
		fileFlowOpen = false;
		fileFlowSelected = null;
		fileFlowMode = 'local';
		fileFlowNote = '';
		fileFlowError = false;
		sheetFlowUrl = '';
		sheetFlowRange = '';
		sheetFlowError = '';
	}

	function handleFileFlowSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) fileFlowSelected = file;
	}

	function submitFile() {
		if (!fileFlowSelected) return;
		const selectedFile = fileFlowSelected;
		const note = fileFlowNote.trim();
		fileFlowUploading = true;
		fileFlowError = false;
		requestAttachmentTriage(selectedFile, note, 'file')
			.then((result) => {
				closeFileFlow();
				presentAttachmentTriage(result);
			})
			.catch(() => {
				fileFlowError = true;
			})
			.finally(() => {
				fileFlowUploading = false;
			});
	}

	function extractSpreadsheetId(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return '';
		if (!trimmed.includes('docs.google.com')) return trimmed;
		return trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? '';
	}

	function serializeSheetValues(values: string[][], maxRows = 40, maxCols = 10, maxChars = 6000): string {
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

	function previewSheetRows(values: string[][], rowCount = 2, colCount = 8): string[] {
		return values.slice(0, rowCount).map((row, index) => {
			const cells = row
				.slice(0, colCount)
				.map((cell) => cell.replace(/[\r\n\t]+/g, ' ').trim())
				.filter((cell) => cell.length > 0);
			return `Rad ${index + 1}: ${cells.join(' | ') || '(tom)'}`;
		});
	}

	async function submitSheetSnapshot() {
		sheetFlowError = '';
		const spreadsheetId = extractSpreadsheetId(sheetFlowUrl);
		if (!spreadsheetId) {
			sheetFlowError = 'Legg inn gyldig Google Sheet-lenke eller spreadsheetId.';
			return;
		}

		sheetFlowUploading = true;
		try {
			const params = new URLSearchParams({ spreadsheetId });
			if (sheetFlowRange.trim()) params.set('range', sheetFlowRange.trim());
			const [response, metaResponse] = await Promise.all([
				fetch(`/api/sensors/google-sheets/read?${params.toString()}`),
				fetch(`/api/sensors/google-sheets/read?spreadsheetId=${encodeURIComponent(spreadsheetId)}&meta=true`)
			]);
			const payload = await response.json();
			const metaPayload = metaResponse.ok ? await metaResponse.json() : null;

			if (!response.ok) {
				throw new Error(payload?.error || 'Kunne ikke lese regnearkdata');
			}

			const values: string[][] = Array.isArray(payload.values) ? payload.values : [];
			const dataText = serializeSheetValues(values);
			const rangeText = payload.range || sheetFlowRange.trim() || 'A1:ZZ10000';
			const sheetTitle = typeof metaPayload?.title === 'string' && metaPayload.title.trim().length > 0
				? metaPayload.title.trim()
				: 'Google Sheet';
			const rowPreview = previewSheetRows(values, 2, 8);
			const rowPreviewText = rowPreview.length > 0 ? rowPreview.join('\n') : 'Ingen rader funnet i valgt range.';
			const note = fileFlowNote.trim();

			const attachment: AttachmentRef = {
				url: sheetFlowUrl.trim() || `google-sheet://${spreadsheetId}`,
				kind: 'document',
				name: `${sheetTitle} (${rangeText})`,
				mimeType: 'application/vnd.google-apps.spreadsheet',
				note,
				source: 'sheet',
				contentText: `Tittel: ${sheetTitle}\nRange: ${rangeText}\n\nForhåndsvisning (2 første rader):\n${rowPreviewText}\n\nUtdrag:\n${dataText}`,
				extractionKind: 'sheet_snapshot'
			};

			const promptContext = `Regnearktittel: ${sheetTitle}. Range: ${rangeText}. Forhåndsvisning: ${rowPreviewText}.${note ? ` Brukernotat: ${note}` : ''}`;

			const triage: AttachmentTriageResponse = {
				attachment,
				triage: {
					summary: `Jeg hentet ${payload.rowCount ?? values.length} rader fra «${sheetTitle}» (${rangeText}). Første rader: ${rowPreviewText}`,
					clarificationQuestion: 'Hva vil du at vi skal gjøre med dette regnearkutdraget?',
					suggestedActions: [
						{
							id: 'sheet-summary',
							label: 'Oppsummer nøkkelpunkter',
							prompt: `Oppsummer de viktigste innsiktene fra dette regnearkutdraget. ${promptContext}`
						},
						{
							id: 'sheet-patterns',
							label: 'Finn mønstre',
							prompt: `Finn mønstre, avvik og ting jeg bør reagere på i dette regnearkutdraget. ${promptContext}`
						},
						{
							id: 'sheet-theme',
							label: 'Knytt til tema',
							prompt: `Hvilket tema passer dette regnearkutdraget best under, og hva er anbefalt neste steg? ${promptContext}`
						}
					],
					detectedIntent: 'analyse-sheet-snapshot',
					confidence: 'high',
					extractedSignals: [
						`Tittel: ${sheetTitle}`,
						`Rader: ${payload.rowCount ?? values.length}`,
						`Kolonner: ${payload.colCount ?? (values[0]?.length ?? 0)}`,
						`Range: ${rangeText}`,
						...rowPreview
					]
				}
			};

			closeFileFlow();
			presentAttachmentTriage(triage);
		} catch (error) {
			sheetFlowError = error instanceof Error ? error.message : 'Noe gikk galt. Prøv igjen.';
		} finally {
			sheetFlowUploading = false;
		}
	}

	function startHomeChat() {
		const draft = chatPrefill.trim();
		if (draft) {
			openChat(draft, 'chat');
			return;
		}
		startQuickAction(QUICK_ACTIONS[0]);
	}

	function startHomeAttachment(kind: 'camera' | 'voice' | 'file') {
		const draft = chatPrefill.trim();
		chatMessages = [];
		createdThemeLink = null;
		currentConversationId = null;
		if (kind === 'camera') {
			cameraCaption = draft;
			cameraOpen = true;
			return;
		}
		if (kind === 'voice') {
			voiceText = draft;
			voiceOpen = true;
			return;
		}
		fileFlowMode = 'local';
		fileFlowNote = draft;
		fileFlowOpen = true;
	}

	function closeChat() {
		if (currentConversationId && chatMessages.length > 0) {
			latestClosedConversationId = currentConversationId;
		}
		chatMessages = [];
		chatPrefill = '';
		createdThemeLink = null;
		launchingThemeId = null;
		currentConversationId = null;
		chatOpen = false;
	}

	async function openCreatedTheme(themeId: string) {
		launchingThemeId = themeId;
		await goto(`/tema/${themeId}?handoff=1`);
	}

	async function sendChat(text: string, imageUrl?: string, attachment?: AttachmentRef) {
		const displayText = text || (imageUrl ? '📷 [Bilde]' : '');
		chatMessages = [...chatMessages, { role: 'user', text: displayText, imageUrl, attachment }];
		chatLoading = true;
		try {
			if (!currentConversationId) {
				try {
					const newConversationRes = await fetch('/api/conversations/new', { method: 'POST' });
					if (newConversationRes.ok) {
						const newConversationData = await newConversationRes.json();
						currentConversationId = newConversationData.conversationId ?? null;
					}
				} catch {
					// Lar API-et håndtere fallback hvis ny samtale ikke kan opprettes her.
				}
			}

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: displayText,
					conversationId: currentConversationId,
					imageUrl,
					attachment
				})
			});
			if (!res.ok) throw new Error();
			const data = await res.json();
			currentConversationId = data.conversationId ?? currentConversationId;
			if (data.themeCreated && data.theme?.id) {
				createdThemeLink = {
					id: data.theme.id,
					name: data.theme.name,
					emoji: data.theme.emoji ?? null
				};
			}
			chatMessages = [...chatMessages, { role: 'assistant', text: data.message }];
			if (data.checklistChanged) await fetchChecklists();
		} catch {
			chatMessages = [...chatMessages, { role: 'assistant', text: 'Noe gikk galt. Prøv igjen.' }];
		} finally {
			chatLoading = false;
		}
	}

	async function unpinWidget(id: string) {
		pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinned: false })
		});
	}

	async function saveWidgetConfig(id: string, updates: Partial<UserWidget>) {
		configWidget = null;
		const res = await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(updates)
		});
		if (res.ok) {
			const updated = await res.json();
			pinnedWidgets = pinnedWidgets.map((w) => w.id === id ? { ...w, ...updated } : w);
		}
	}



	function navigateForWidget(w: UserWidget) {
		const healthMetrics = ['weight', 'sleepDuration', 'steps', 'distance', 'workoutCount', 'heartrate', 'mood'];
		const econMetrics = ['amount'];
		if (healthMetrics.includes(w.metricType)) {
			const t = themes.find((t) => t.name.trim().toLowerCase() === 'helse');
			void goto(t ? `/tema/${t.id}` : '/health');
		} else if (econMetrics.includes(w.metricType)) {
			const t = themes.find((t) => t.name.trim().toLowerCase() === 'økonomi');
			void goto(t ? `/tema/${t.id}` : '/economics');
		} else {
			void goto('/');
		}
	}

	const dateLabel = $derived(
		new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
	);
</script>

<div class="home-screen">

	<!-- ── SONE 1: Tittel ── -->
	<section class="zone zone-title" class:hidden={chatOpen}>
		<div class="title-row">
			<ScreenTitle title="Resonans" subtitle={dateLabel} />
			<div class="title-right">
				<a href="/goals" class="icon-link" aria-label="Mål"><Icon name="goals" size={20} /></a>
				<a href="/settings" class="icon-link" aria-label="Innstillinger"><Icon name="settings" size={18} /></a>
			</div>
		</div>
	</section>

	<!-- ── SONE 2: Widgets ── -->
	<section class="zone zone-widgets" class:hidden={chatOpen} aria-label="Sensor-oversikt">

		<div class="widget-row">
			{#if widgetsLoading}
			{#each { length: 3 } as _, i}
				<div class="widget-skeleton" style:animation-delay="{i * 120}ms"></div>
			{/each}
		{:else if pinnedWidgets.length > 0}
			{#each pinnedWidgets as w}
				<DynamicWidget
					widgetId={w.id}
					title={w.title}
					unit={w.unit}
					color={w.color}
					pinned={w.pinned}
					onpress={() => navigateForWidget(w)}
					onchat={(summary) => openChat(summary)}
					onunpin={() => unpinWidget(w.id)}
					onconfig={() => (configWidget = w)}
				/>
			{/each}
		{:else}
			{#each WIDGETS as w}
				<WidgetCircle
					label={w.label}
					val={w.val}
					unit={w.unit}
					color={w.color}
					active={false}
					onpress={() => goto(w.sensorType === 'spending' ? '/economics' : `/sensor/${w.sensorType}`)}
					onchat={() => openChat(`Spør om ${w.label.toLowerCase()}`)}
				/>
			{/each}
		{/if}

			{#each activeChecklists as cl (cl.id)}
				<ChecklistWidget
					checklist={cl}
					onclick={() => (openChecklist = cl)}
					onremove={async () => {
						await fetch(`/api/checklists/${cl.id}`, { method: 'DELETE' });
						activeChecklists = activeChecklists.filter((c) => c.id !== cl.id);
					}}
				/>
			{/each}
		</div>
	</section>

	<!-- ── SONE 3: Tema ── -->
	<section class="zone zone-tema" class:hidden={chatOpen} aria-label="Temaer">
		<p class="zone-label">Temaer</p>
		{#if themes.length}
			<div class="tema-v3-grid">
				{#each themes.slice(0, 6) as theme}
					<button class="tema-btn-v3" style={getThemeHueStyle(theme.name)} onclick={() => goto(`/tema/${theme.id}`)}>
						<span class="tema-btn-v3-icon">{theme.emoji}</span>
						<span class="tema-btn-v3-label">{theme.name}</span>
					</button>
				{/each}
			</div>
		{:else}
			<button class="onboarding-cta" onclick={() => openChat('Jeg vil sette opp mitt første tema. Hjelp meg å definere hva jeg ønsker å fokusere på.')}>
			<span class="cta-icon"><Icon name="goals" size={18} /></span>
			<span class="cta-text">Kom i gang med temaer</span>
			<span class="cta-arrow">→</span>
		</button>
		{/if}
	</section>

	<!-- ── SONE 4: Chat ── -->
	<section class="zone zone-input" class:zone-chat-open={chatOpen} aria-label="Chat">
		{#if chatOpen}
			<div class="chat-header">
				<button class="chat-back" onclick={closeChat} aria-label="Lukk chat"><Icon name="back" size={18} /></button>
				<div class="chat-heading-wrap">
					<span class="chat-heading">{activeQuickAction.label}</span>
					<span class="chat-subheading">{activeQuickAction.description}</span>
				</div>
				<button class="chat-link" onclick={() => goto(currentConversationId ? `/samtaler?conversation=${currentConversationId}` : '/samtaler')} aria-label="Åpne samtaler">Samtaler</button>
			</div>
			<div class="chat-messages" aria-live="polite">
				{#if chatMessages.length === 0 && !chatLoading}
					<div class="quick-flow-card">
						<div class="quick-flow-mark"><Icon name={activeQuickAction.icon} size={18} /></div>
						<div class="quick-flow-copy">
							<p class="quick-flow-title">{activeQuickAction.label}</p>
							<p class="quick-flow-text">{activeQuickAction.helper}</p>
						</div>
					</div>
					<p class="chat-empty">Skriv første utkast, så hjelper vi deg å plassere det videre etterpå.</p>
				{/if}
				{#each chatMessages as msg}
					{#if msg.role === 'user'}
						<div class="bubble-user">
							{#if msg.imageUrl}
								<img class="bubble-img" src={msg.imageUrl} alt="Bilde" />
							{/if}
							{#if msg.attachment && !msg.imageUrl}
								<div class="bubble-attachment">
									<span class="bubble-attachment-icon">
										{#if msg.attachment.kind === 'audio'}🎙️{:else if msg.attachment.kind === 'document'}📄{:else}📎{/if}
									</span>
									<div class="bubble-attachment-copy">
										<span class="bubble-attachment-name">{msg.attachment.name}</span>
										<span class="bubble-attachment-meta">{msg.attachment.mimeType || 'vedlegg'}</span>
									</div>
								</div>
							{/if}
							{#if msg.text && msg.text !== '📷 [Bilde]'}<span>{msg.text}</span>{/if}
						</div>
					{:else}
						<TriageCard text={msg.text} actions={msg.actions} />
					{/if}
				{/each}
				{#if chatLoading}
					<TriageCard loading={true} />
				{/if}
			</div>
			<div class="chat-input-area">
				{#if createdThemeLink}
					{@const themeLink = createdThemeLink}
					<button
						class="theme-link-banner"
						style={getThemeHueStyle(themeLink.name)}
						class:is-launching={launchingThemeId === themeLink.id}
						disabled={launchingThemeId === themeLink.id}
						onclick={() => openCreatedTheme(themeLink.id)}
					>
						<span class="theme-link-icon">{#if themeLink.emoji}{themeLink.emoji}{:else}<Icon name="goals" size={15} />{/if}</span>
						<span>{launchingThemeId === themeLink.id ? `Åpner ${themeLink.name}…` : `Åpne ${themeLink.name}`}</span>
						<span class="theme-link-arrow">→</span>
					</button>
				{/if}
				{#key `${activeQuickAction.id}:${chatPrefill}`}
					<ChatInput
						placeholder={activeQuickAction.placeholder}
						initialValue={chatPrefill}
						disabled={chatLoading}
						onsubmit={sendChat}
					/>
				{/key}
			</div>
		{:else if cameraOpen}
			<!-- ── Kamera-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeCameraFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
					<span class="flow-title">Kamera</span>
				</div>
				<input
					type="file"
					accept="image/*"
					style="display:none"
					bind:this={cameraFileInput}
					onchange={handleCameraFileSelect}
				/>
				<div class="flow-body">
					{#if !cameraPreview}
						<button class="upload-zone" onclick={() => cameraFileInput?.click()}>
							<span class="upload-zone-icon"><Icon name="camera" size={28} /></span>
							<p class="upload-zone-label">Velg bilde eller ta foto</p>
							<p class="upload-zone-sub">Skjermtid · Kvittering · Blodprøve · Notat</p>
						</button>
					{:else}
						<div class="img-preview">
							<img src={cameraPreview} alt="Forhåndsvisning" />
							<button class="preview-clear" onclick={() => { cameraPreview = null; cameraSelectedFile = null; }} aria-label="Fjern bilde"><Icon name="close" size={13} /></button>
						</div>
						<textarea
							class="flow-textarea"
							placeholder="Beskriv eller legg til kontekst (valgfritt)…"
							bind:value={cameraCaption}
							rows="2"
						></textarea>
						{#if cameraError}
							<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
						{/if}
						<button class="flow-submit" onclick={submitCamera} disabled={cameraUploading}>
							{cameraUploading ? 'Triagerer…' : 'Last opp og triager →'}
						</button>
					{/if}
				</div>
			</div>
		{:else if voiceOpen}
			<!-- ── Lyd-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeVoiceFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
					<span class="flow-title">Lyd</span>
				</div>
				<input
					bind:this={voiceFileInput}
					type="file"
					accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm"
					class="sr-only"
					onchange={handleVoiceFileSelect}
				/>
				<div class="flow-body">
					{#if !voiceSelectedFile}
						<button class="upload-zone" onclick={() => voiceFileInput?.click()}>
							<span class="upload-zone-icon"><Icon name="wave" size={28} /></span>
							<p class="upload-zone-label">Velg lydfil</p>
							<p class="upload-zone-sub">Opptak · talememo · møteklipp · refleksjon</p>
						</button>
					{:else}
						<div class="selected-file-chip">
							<div class="selected-file-chip__meta">
								<span class="selected-file-chip__icon"><Icon name="wave" size={16} /></span>
								<div>
									<p>{voiceSelectedFile.name}</p>
									<small>{Math.max(1, Math.round(voiceSelectedFile.size / 1024))} KB</small>
								</div>
							</div>
							<button class="selected-file-chip__clear" onclick={() => {
								voiceSelectedFile = null;
								voiceError = false;
								if (voiceFileInput) voiceFileInput.value = '';
							}} aria-label="Fjern lydfil">
								<Icon name="close" size={13} />
							</button>
						</div>
						<p class="flow-hint">Legg til litt kontekst hvis du vil at triagen skal forstå hva lydfilen gjelder.</p>
						<textarea
							class="flow-textarea flow-textarea--lg"
							placeholder="Hva er dette opptaket, og hva vil du ha hjelp til?"
							bind:value={voiceText}
							rows="4"
						></textarea>
						{#if voiceError}
							<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
						{/if}
						<button class="flow-submit" onclick={submitVoice} disabled={voiceUploading}>
							{voiceUploading ? 'Triagerer…' : 'Last opp og triager →'}
						</button>
					{/if}
				</div>
			</div>
		{:else if moodOpen}
			<!-- ── Stemning-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeMoodFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
					<span class="flow-title">Stemning</span>
				</div>
				<div class="flow-body">
					<!-- Slider -->
					<div class="ci-slider-wrap">
						<div class="ci-slider-display" style:color={moodColor}>
							<span class="ci-slider-emoji">{moodEmoji}</span>
							<span class="ci-slider-label">{moodLabel}</span>
							<span class="ci-slider-num">{moodSlider}</span>
						</div>
						<input
							type="range"
							class="ci-slider"
							min="0" max="100" step="1"
							bind:value={moodSlider}
							style:--thumb-color={moodColor}
							aria-label="Stemningsnivå"
						/>
						<div class="ci-slider-ends">
							<span>😔</span>
							<span>🤩</span>
						</div>
					</div>

					<!-- Faktor-grid -->
					<div class="ci-factors-label">Hva påvirker stemningen din mest?</div>
					<div class="ci-factors-grid">
						{#each MOOD_FACTORS as factor}
							<button
								class="ci-factor-btn"
								class:is-active={moodFactors.includes(factor.id)}
								onclick={() => toggleFactor(factor.id)}
								aria-pressed={moodFactors.includes(factor.id)}
							>
								<span class="ci-factor-icon">{factor.icon}</span>
								<span class="ci-factor-label">{factor.label}</span>
							</button>
						{/each}
					</div>

					<!-- Notat -->
					<textarea
						class="flow-textarea"
						placeholder="Vil du legge til noe? (valgfritt)"
						bind:value={moodNote}
						rows="2"
					></textarea>
					<button class="flow-submit" onclick={submitMood}>
						Send til chat →
					</button>
				</div>
			</div>
		{:else if fileFlowOpen}
			<!-- ── Fil-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeFileFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
					<span class="flow-title">Fil</span>
				</div>
				<input
					type="file"
					accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,text/*"
					style="display:none"
					bind:this={fileFlowInput}
					onchange={handleFileFlowSelect}
				/>
				<div class="flow-body">
					{#if fileFlowMode === 'sheet'}
						<p class="flow-hint">Legg inn lenke eller spreadsheetId for å hente et snapshot av regnearket.</p>
						<input
							type="text"
							class="flow-input"
							placeholder="Google Sheet URL eller spreadsheetId"
							bind:value={sheetFlowUrl}
						/>
						<input
							type="text"
							class="flow-input"
							placeholder="Range (valgfritt), f.eks. Sheet1!A1:F120"
							bind:value={sheetFlowRange}
						/>
						<textarea
							class="flow-textarea"
							placeholder="Hva vil du bruke dette regnearket til? (valgfritt)"
							bind:value={fileFlowNote}
							rows="3"
						></textarea>
						{#if sheetFlowError}
							<p class="flow-error">{sheetFlowError}</p>
						{/if}
						<div class="flow-inline-actions">
							<button class="flow-ghost" onclick={() => (fileFlowMode = 'local')} disabled={sheetFlowUploading}>
								Bruk lokal fil i stedet
							</button>
							<button class="flow-submit" onclick={submitSheetSnapshot} disabled={sheetFlowUploading}>
								{sheetFlowUploading ? 'Henter…' : 'Hent og triager →'}
							</button>
						</div>
					{:else if !fileFlowSelected}
						<button class="upload-zone" onclick={() => fileFlowInput?.click()}>
							<span class="upload-zone-icon"><Icon name="file" size={28} /></span>
							<p class="upload-zone-label">Velg fil</p>
							<p class="upload-zone-sub">PDF · Word · Excel · Tekst</p>
						</button>
						<button class="flow-ghost" onclick={() => (fileFlowMode = 'sheet')}>
							Eller bruk Google Sheet snapshot
						</button>
					{:else}
						<div class="file-chip">
							<span class="file-chip-icon"><Icon name="file" size={18} /></span>
							<span class="file-chip-name">{fileFlowSelected.name}</span>
							<button class="preview-clear" onclick={() => fileFlowSelected = null} aria-label="Fjern fil"><Icon name="close" size={13} /></button>
						</div>
						<textarea
							class="flow-textarea"
							placeholder="Hva vil du gjøre med denne filen? (valgfritt)"
							bind:value={fileFlowNote}
							rows="2"
						></textarea>
						{#if fileFlowError}
							<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
						{/if}
						<button class="flow-submit" onclick={submitFile} disabled={fileFlowUploading}>
							{fileFlowUploading ? 'Triagerer…' : 'Last opp og triager →'}
						</button>
						<button class="flow-ghost" onclick={() => {
							fileFlowSelected = null;
							fileFlowMode = 'sheet';
						}} disabled={fileFlowUploading}>
							Bruk Google Sheet snapshot i stedet
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="input-v4">
				<textarea
					class="input-field-v4"
					placeholder="Hva tenker du på?"
					bind:value={chatPrefill}
					rows="3"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && chatPrefill.trim()) {
							e.preventDefault();
							startHomeChat();
						}
					}}
				></textarea>
				<div class="input-actions-v4">
					{#if hasHomeDraft}
						<button
							class="icon-btn-v4"
							title="Send"
							onclick={startHomeChat}
						>
							<Icon name="forward" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Legg til bilde til chat"
							onclick={() => startHomeAttachment('camera')}
						>
							<Icon name="camera" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Legg til lyd til chat"
							onclick={() => startHomeAttachment('voice')}
						>
							<Icon name="wave" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Legg til fil til chat"
							onclick={() => startHomeAttachment('file')}
						>
							<Icon name="attach" size={18} />
						</button>
					{:else}
						<button
							class="icon-btn-v4"
							title="Legg ved bilde"
							onclick={() => startQuickAction(QUICK_ACTIONS[1])}
						>
							<Icon name="camera" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Legg ved lyd"
							onclick={() => startQuickAction(QUICK_ACTIONS[2])}
						>
							<Icon name="wave" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Legg ved fil"
							onclick={() => startQuickAction(QUICK_ACTIONS[4])}
						>
							<Icon name="attach" size={18} />
						</button>
						<button
							class="icon-btn-v4"
							title="Sjekk inn"
							onclick={() => startQuickAction(QUICK_ACTIONS[3])}
						>
							<Icon name="checkin" size={18} />
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</section>

</div>

<!-- ── WIDGET CONFIG SHEET ── -->
{#if configWidget}
	<WidgetConfigSheet
		widget={configWidget}
		open={true}
		onclose={() => (configWidget = null)}
		onsave={(updates) => saveWidgetConfig(configWidget!.id, updates)}
	/>
{/if}

<!-- ── CHECKLIST SHEET ── -->
{#if openChecklist}
	<ChecklistSheet
		checklist={openChecklist}
		onclose={() => (openChecklist = null)}
		onDeleted={() => {
			activeChecklists = activeChecklists.filter((c) => c.id !== openChecklist?.id);
			openChecklist = null;
		}}
	/>
{/if}

<style>
	/* ── Grunnlayout ── */
	.home-screen {
		height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Soner ── */
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	.hidden {
		display: none;
	}

	/* ── Tittel-sone (10 %) ── */
	.zone-title {
		flex: 10 0 0;
		min-height: 0;
		display: flex;
		align-items: flex-start;
		padding: var(--screen-title-top-pad, 34px) 20px 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.title-right {
		display: flex;
		gap: 4px;
	}

	.icon-link {
		color: #555;
		text-decoration: none;
		min-width: 40px;
		min-height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s;
	}

	.icon-link:hover {
		color: #aaa;
	}

	/* ── Widget-sone (25 %) — kort med avrundede hjørner ── */
	.zone-widgets {
		flex: 25 0 0;
		min-height: 0;
		padding: 14px 16px 10px;
		background: #171717;
		border-radius: 18px;
		margin: 0 12px;
	}

	/* ── Tema-sone (30 %) ── */
	.zone-tema {
		flex: 30 0 0;
		min-height: 0;
		padding: 12px 20px 8px;
	}

	/* ── Zone-label ── */
	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 10px;
	}

	/* ── Widget-rad — sentrert, bryter til ny linje ved behov ── */
	.widget-row {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		justify-content: center;
	}

	/* ── Widget-skeleton (laster) ── */
	.widget-skeleton {
		width: 72px;
		height: 88px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.widget-skeleton::before {
		content: '';
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #1e1e1e;
		animation: skeleton-pulse 1.4s ease-in-out infinite;
	}

	.widget-skeleton::after {
		content: '';
		width: 40px;
		height: 8px;
		border-radius: 4px;
		background: #1e1e1e;
		animation: skeleton-pulse 1.4s ease-in-out infinite;
		animation-delay: inherit;
	}

	@keyframes skeleton-pulse {
		0%, 100% { background: #1e1e1e; }
		50%       { background: #2c2c2c; }
	}

	.onboarding-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
		width: 100%;
		color: #888;
		font-size: 0.82rem;
		transition: background 0.15s, border-color 0.15s;
	}

	.onboarding-cta:hover {
		background: #222;
		border-color: #4a5af0;
		color: #aaa;
	}

	.cta-icon {
		color: #4a5af0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.cta-text {
		flex: 1;
		text-align: left;
	}

	.cta-arrow {
		color: #555;
	}

	/* ── Tema v3: 3-kolonne grid med kompakte knapper ── */
	.tema-v3-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}

	.tema-btn-v3 {
		--theme-hue: 228;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		background: linear-gradient(180deg, hsl(var(--theme-hue) 20% 12%) 0%, hsl(var(--theme-hue) 18% 10%) 100%);
		border: none;
		border-radius: 16px;
		padding: 16px 8px;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
		font: inherit;
		color: #ddd;
	}

	.tema-btn-v3:hover {
		background: linear-gradient(180deg, hsl(var(--theme-hue) 24% 15%) 0%, hsl(var(--theme-hue) 20% 12%) 100%);
		box-shadow: 0 8px 20px hsl(var(--theme-hue) 55% 18% / 0.2);
		transform: translateY(-1px);
	}

	.tema-btn-v3-icon {
		font-size: 1.5rem;
		line-height: 1;
		filter: drop-shadow(0 2px 8px hsl(var(--theme-hue) 70% 18% / 0.25));
	}

	.tema-btn-v3-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: hsl(var(--theme-hue) 22% 80%);
	}

	/* ── Input-sone (35 %) — kort med avrundede hjørner ── */
	.zone-input {
		flex: 35 0 0;
		min-height: 0;
		padding: 12px 14px;
		padding-bottom: calc(12px + env(safe-area-inset-bottom, 8px));
		background: #171717;
		border-radius: 18px;
		margin: 0 12px;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		box-sizing: border-box;
		overflow: hidden;
	}

	.zone-chat-open {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: #0f0f0f;
	}

	/* ── Input v4: felt + kontekstavhengige handlinger ── */
	.input-v4 {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: stretch;
		width: 100%;
	}

	.input-actions-v4 {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 10px;
	}

	.input-field-v4 {
		flex: 1;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 14px 16px;
		color: #ddd;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.45;
		min-height: 126px;
		resize: none;
		overflow-y: auto;
		transition: border-color 0.15s;
	}

	.input-field-v4::placeholder {
		color: #555;
	}

	.input-field-v4:focus {
		outline: none;
		border-color: #3a3a3a;
	}

	.icon-btn-v4 {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #aaa;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, transform 0.15s;
		flex-shrink: 0;
	}

	.icon-btn-v4:hover {
		background: #222;
		border-color: #3a3a3a;
		transform: translateY(-2px);
	}

	/* ── Flow-panel (kamera / lyd / stemning / fil) ──────────────────────── */
	.flow-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.flow-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.flow-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.flow-back:hover { color: #ccc; }

	.flow-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
	}

	.flow-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.flow-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #555;
	}

	.flow-textarea {
		width: 100%;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		line-height: 1.5;
		resize: none;
		box-sizing: border-box;
	}
	.flow-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}
	.flow-textarea::placeholder { color: #3a3a3a; }
	.flow-textarea--lg { min-height: 120px; }

	.flow-input {
		width: 100%;
		background: #111;
		border: 1px solid #242424;
		border-radius: 12px;
		padding: 11px 12px;
		color: #ddd;
		font: inherit;
		font-size: 0.85rem;
		transition: border-color 0.15s;
	}

	.flow-input:focus {
		outline: none;
		border-color: #3a3a3a;
	}

	.flow-input::placeholder {
		color: #3a3a3a;
	}

	.flow-submit {
		background: #4a5af0;
		border: none;
		color: #fff;
		border-radius: 14px;
		padding: 13px 20px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
		transition: background 0.15s, opacity 0.15s;
	}
	.flow-submit:hover:not(:disabled) { background: #3a4adf; }
	.flow-submit:disabled { opacity: 0.4; cursor: default; }

	.flow-inline-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.flow-ghost {
		width: 100%;
		background: #151515;
		border: 1px solid #2c2c2c;
		border-radius: 12px;
		padding: 11px 12px;
		color: #aaa;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.flow-ghost:hover:not(:disabled) {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}

	.flow-ghost:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.flow-error {
		margin: 0;
		font-size: 0.8rem;
		color: #e07070;
	}

	/* Upload zone (kamera + fil) */
	.upload-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: #111;
		border: 2px dashed #2a2a2a;
		border-radius: 18px;
		padding: 36px 20px;
		cursor: pointer;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
		font: inherit;
	}
	.upload-zone:hover { border-color: #3c4f9f; background: #121218; }

	.upload-zone-icon {
		color: #4a5af0;
		opacity: 0.7;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.upload-zone-label {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #ccc;
	}

	.upload-zone-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #555;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Image preview */
	.img-preview {
		position: relative;
		border-radius: 14px;
		overflow: hidden;
		max-height: 200px;
	}
	.img-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.preview-clear {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0,0,0,0.7);
		border: none;
		color: #fff;
		border-radius: 50%;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 0.8rem;
	}

	/* File chip */
	.file-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.file-chip-icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.file-chip-name {
		flex: 1;
		font-size: 0.85rem;
		color: #ccc;
		word-break: break-all;
	}

	.selected-file-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.selected-file-chip__meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}

	.selected-file-chip__meta p,
	.selected-file-chip__meta small {
		margin: 0;
		display: block;
	}

	.selected-file-chip__meta p {
		font-size: 0.84rem;
		font-weight: 600;
		color: #d5d5d5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selected-file-chip__meta small {
		font-size: 0.72rem;
		color: #666;
	}

	.selected-file-chip__icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.selected-file-chip__clear {
		background: transparent;
		border: none;
		color: #777;
		cursor: pointer;
		padding: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.selected-file-chip__clear:hover {
		background: #202020;
		color: #d5d5d5;
	}

	/* ── Sjekkin-flyt ────────────────────────────────────────────────────────── */
	.ci-slider-wrap {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ci-slider-display {
		display: flex;
		align-items: baseline;
		gap: 10px;
		transition: color 0.2s;
	}

	.ci-slider-emoji {
		font-size: 2rem;
		line-height: 1;
		transition: filter 0.2s;
	}

	.ci-slider-label {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.ci-slider-num {
		font-size: 0.75rem;
		opacity: 0.5;
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}

	.ci-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 6px;
		border-radius: 999px;
		background: #222;
		outline: none;
		cursor: pointer;
	}
	.ci-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--thumb-color, #4a5af0);
		border: 3px solid #0f0f0f;
		box-shadow: 0 0 0 1px var(--thumb-color, #4a5af0);
		transition: background 0.2s, box-shadow 0.2s;
		cursor: grab;
	}
	.ci-slider::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--thumb-color, #4a5af0);
		border: 3px solid #0f0f0f;
		cursor: grab;
	}

	.ci-slider-ends {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		opacity: 0.4;
	}

	.ci-factors-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #555;
		margin-top: 4px;
	}

	.ci-factors-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.ci-factor-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		background: #141414;
		border: 1.5px solid #252525;
		border-radius: 14px;
		padding: 10px 6px;
		cursor: pointer;
		font: inherit;
		transition: border-color 0.12s, background 0.12s, transform 0.1s;
	}
	.ci-factor-btn:hover { border-color: #3c4f9f; background: #16191f; }
	.ci-factor-btn.is-active {
		border-color: #4a5af0;
		background: #12152a;
		transform: scale(1.04);
	}

	.ci-factor-icon { font-size: 1.3rem; line-height: 1; }
	.ci-factor-label {
		font-size: 0.62rem;
		font-weight: 600;
		color: #888;
		text-align: center;
		line-height: 1.2;
	}
	.ci-factor-btn.is-active .ci-factor-label { color: #c5cdf8; }

	/* Bubble image */
	.bubble-img {
		display: block;
		max-width: 100%;
		border-radius: 10px;
		margin-bottom: 6px;
	}

	.bubble-attachment {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		margin-bottom: 6px;
	}

	.bubble-attachment-icon {
		font-size: 1rem;
		line-height: 1;
	}

	.bubble-attachment-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.bubble-attachment-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: #ececff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bubble-attachment-meta {
		font-size: 0.7rem;
		color: #9093a9;
	}

	.chat-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: env(safe-area-inset-top, 12px) 16px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.chat-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.chat-back:hover { color: #ccc; }

	.chat-heading {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
		letter-spacing: -0.01em;
	}

	.chat-heading-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.chat-subheading {
		font-size: 0.74rem;
		color: #5d5d5d;
	}

	.chat-link {
		border: 1px solid #292929;
		background: #111;
		color: #8f8f8f;
		border-radius: 999px;
		padding: 7px 11px;
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.chat-link:hover {
		border-color: #3c4f9f;
		color: #d4daf6;
	}


	.quick-flow-card {
		align-self: stretch;
		display: flex;
		gap: 12px;
		background: linear-gradient(180deg, #13151c 0%, #101114 100%);
		border: 1px solid #222839;
		border-radius: 18px;
		padding: 14px;
	}

	.quick-flow-mark {
		width: 42px;
		height: 42px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #161b28;
		border: 1px solid #2a3557;
		color: #b6c2f8;
		flex-shrink: 0;
	}

	.quick-flow-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.quick-flow-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e3e6f6;
	}

	.quick-flow-text {
		margin: 0;
		font-size: 0.79rem;
		line-height: 1.45;
		color: #8d93aa;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.chat-empty {
		color: #2e2e2e;
		font-size: 0.85rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.bubble-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 80%;
		white-space: pre-wrap;
		word-break: break-word;
		color: #ccc;
	}

	.chat-input-area {
		padding: 10px 14px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.theme-link-banner {
		--theme-hue: 228;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: linear-gradient(180deg, hsl(var(--theme-hue) 24% 13%) 0%, hsl(var(--theme-hue) 20% 11%) 100%);
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		border-radius: 14px;
		padding: 11px 12px;
		color: hsl(var(--theme-hue) 54% 88%);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
		transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
	}

	.theme-link-banner:hover {
		border-color: hsl(var(--theme-hue) 34% 42%);
	}

	.theme-link-banner.is-launching {
		opacity: 0.75;
		transform: scale(0.99);
		cursor: default;
	}

	.theme-link-icon {
		width: 28px;
		height: 28px;
		border-radius: 9px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: hsl(var(--theme-hue) 24% 16%);
		border: 1px solid hsl(var(--theme-hue) 28% 32%);
		flex-shrink: 0;
	}

	.theme-link-arrow {
		margin-left: auto;
		color: hsl(var(--theme-hue) 32% 68%);
	}



</style>


