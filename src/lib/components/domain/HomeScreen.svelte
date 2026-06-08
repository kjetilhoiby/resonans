<!--
  HomeScreen — fire-sone hjemskjerm.

  Layout: 10 / 28 / 24 / 28  (tittel / widgets / tema / input)
  Ingen tab-bar, ingen overlays. Soner animerer til fullskjerm ved tap.

  Sonene er ekstrahert til egne komponenter i ./home/:
    HomeTitleZone  — SONE 1
    HomeWidgetZone — SONE 2
    HomeThemeZone  — SONE 3
    HomeChatZone   — SONE 4

  Delt state publiseres via setContext(HOME_CTX, ctx).

  Forretningslogikk er ekstrahert til:
    home-data.ts           — datafetching, caching, dato-hjelpere
    home-chat.ts           — attachment-triage, sheet-snapshot, quick actions
    home-theme-drag.ts     — drag-and-drop, tema-meny
    home-media.ts          — kamera/lyd/fil-flyt handlers
    home-conversations.ts  — samtale-liste, snooze-meny

  Props:
    themes    aktive temaer fra DB (for tema-grid)
-->
<script lang="ts">
	import { goto, preloadCode, preloadData } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, setContext } from 'svelte';
	import PullToRefresh from '../ui/PullToRefresh.svelte';
	import type { ActionCandidate, ActionIntent } from '$lib/types/actions';
	import { prefetchWidgetData } from '$lib/client/widget-data-cache';
	import { finishNavMetric, startNavMetric, timeAsync } from '$lib/client/nav-metrics';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { Checklist } from '../composed/ChecklistWidget.svelte';

	import HomeTitleZone from './home/HomeTitleZone.svelte';
	import HomeWidgetZone from './home/HomeWidgetZone.svelte';
	import HomeThemeZone from './home/HomeThemeZone.svelte';
	import HomeChatZone from './home/HomeChatZone.svelte';
	import HomeOverlays from './home/HomeOverlays.svelte';
	import {
		HOME_CTX,
		type HomeContext,
		type Theme,
		type QuickActionId,
		type UserWidget,
		type SensorSummary,
		type MediaHistoryItem,
		type HomeWidgetEntry,
		type AttachmentRef,
		type ActionItem,
		type RecentConversation,
		type EgenfrekvensSlotSummary,
		type EgenfrekvensRecentPoint,
	} from './home/home-context';

	import {
		toLocalIsoDate,
		toLocalYearMonth,
		getLocalIsoWeekDashed,
		readCachedPayload,
		writeCachedPayload,
		HOME_SENSOR_CACHE_KEY,
		HOME_PINNED_WIDGETS_CACHE_KEY,
		HOME_SENSOR_CACHE_MAX_AGE_MS,
		HOME_PINNED_WIDGETS_CACHE_MAX_AGE_MS,
		fetchChecklistData,
		fetchSensorAndWidgets,
		loadActionCandidates as fetchActionCandidates,
		loadEgenfrekvensRecent as fetchEgenfrekvensRecent,
		fetchMediaHistory,
		fetchWeekPlanContext,
		fetchMonthPlanContext,
		buildWeekPlanFlowContext,
		buildMonthPlanFlowContext,
		loadEgenfrekvensContext as fetchEgenfrekvensContext,
		fetchQuickWinItems,
		scheduleWidgetDataPrefetch,
		chunkWidgets,
		WIDGETS_PER_PAGE,
	} from './home/home-data';

	import {
		QUICK_ACTIONS,
		formatFollowUpDate,
		currentSlotFromTime,
		shouldAutoFocusInput,
		isRelationshipThemeName,
	} from './home/home-chat';

	import {
		computeDropIndex,
		computeReorder,
		persistThemeOrder,
		archiveTheme,
		deleteTheme,
	} from './home/home-theme-drag';

	import {
		handleCameraFileSelect as cameraFileSelectHandler,
		closeCameraFlow as cameraCloseHandler,
		submitCamera as cameraSubmitHandler,
		reuseCameraMedia as cameraReuseHandler,
		handleVoiceFileSelect as voiceFileSelectHandler,
		closeVoiceFlow as voiceCloseHandler,
		submitVoice as voiceSubmitHandler,
		reuseVoiceMedia as voiceReuseHandler,
		handleFileFlowSelect as fileFlowSelectHandler,
		closeFileFlow as fileCloseHandler,
		submitFile as fileSubmitHandler,
		submitSheetSnapshot as sheetSnapshotHandler,
		reuseFileMedia as fileReuseHandler,
	} from './home/home-media';

	import {
		setConversationStarred,
		setConversationArchived,
		removeConversation,
		moveConversationTheme,
		startConversationRename,
		cancelConversationRename,
		commitConversationRename,
		startLongPress as longPressStart,
		cancelLongPress as longPressCancel,
		handleChipClick as chipClickHandler,
		closeSnoozeMenu as snoozeMenuClose,
		snoozeChip as snoozeChipHandler,
	} from './home/home-conversations';

	interface Props {
		themes: Theme[];
		recentConversations: RecentConversation[];
		programReadiness?: {
			programId: string;
			programName: string;
			state: 'klar' | 'lett' | 'easy' | 'rest';
			alternativeName: string | null;
		} | null;
	}

	let { themes: initialThemes, recentConversations, programReadiness = null }: Props = $props();

	// ── Tema-state ────────────────────────────────────────────────────────
	let themes = $state(initialThemes);
	$effect(() => { themes = initialThemes; });

	const relationshipOnboardingActive = $derived($page.url.searchParams.get('onboarding') === 'partner');
	const relationshipTheme = $derived(themes.find((theme) => isRelationshipThemeName(theme.name)) ?? null);

	// ── Drag-and-drop for tema-rekkefølge ─────────────────────────────────
	let dragThemeId = $state<string | null>(null);
	let dropIndex = $state<number | null>(null);
	let isTouchDrag = $state(false);
	let themeListEl = $state<HTMLElement | null>(null);
	let touchChip = $state<{ left: number; width: number; height: number; top: number } | null>(null);
	let grabOffsetY = 0;

	const draggedTheme = $derived(dragThemeId ? (themes.find((t) => t.id === dragThemeId) ?? null) : null);

	type DisplayEntry =
		| { type: 'theme'; theme: Theme; key: string; collapsed: boolean }
		| { type: 'placeholder'; key: string };
	const displayList = $derived.by<DisplayEntry[]>(() => {
		if (!dragThemeId || dropIndex === null) return themes.map((t) => ({ type: 'theme', theme: t, key: t.id, collapsed: false }));
		const out: DisplayEntry[] = [];
		let remainingSeen = 0;
		let placed = false;
		for (const t of themes) {
			const isDragged = t.id === dragThemeId;
			if (!placed && !isDragged && remainingSeen === dropIndex) { out.push({ type: 'placeholder', key: '__drop_slot__' }); placed = true; }
			out.push({ type: 'theme', theme: t, key: t.id, collapsed: isDragged });
			if (!isDragged) remainingSeen++;
		}
		if (!placed) out.push({ type: 'placeholder', key: '__drop_slot__' });
		return out;
	});

	function resetDrag() { dragThemeId = null; dropIndex = null; isTouchDrag = false; touchChip = null; }

	function handleThemeDragStart(id: string) {
		dragThemeId = id; isTouchDrag = false;
		const startId = id;
		requestAnimationFrame(() => { if (dragThemeId === startId && dropIndex === null) dropIndex = themes.findIndex((t) => t.id === startId); });
	}

	function handleThemeDragOver(e: DragEvent) {
		if (!dragThemeId) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropIndex = computeDropIndex(e.clientY, themeListEl, dragThemeId, dropIndex);
	}

	function commitThemeReorder() {
		const fromId = dragThemeId; const idx = dropIndex; resetDrag();
		if (!fromId || idx === null) return;
		const reordered = computeReorder(themes, fromId, idx);
		if (!reordered) return;
		themes = reordered; persistThemeOrder(reordered);
	}

	function handleTouchDragStart(e: TouchEvent, id: string) {
		cancelThemeRowPress();
		const touch = e.touches[0];
		const row = (e.currentTarget as HTMLElement).closest('[data-theme-id]') as HTMLElement | null;
		const rect = (row ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
		grabOffsetY = touch.clientY - rect.top;
		touchChip = { left: rect.left, width: rect.width, height: rect.height, top: rect.top };
		dragThemeId = id; isTouchDrag = true; dropIndex = themes.findIndex((t) => t.id === id);
	}

	function handleTouchDragMove(e: TouchEvent) {
		if (!dragThemeId) return; e.preventDefault();
		const touch = e.touches[0];
		if (touchChip) touchChip = { ...touchChip, top: touch.clientY - grabOffsetY };
		dropIndex = computeDropIndex(touch.clientY, themeListEl, dragThemeId, dropIndex);
	}

	function handleTouchDragEnd() { if (!dragThemeId) return; commitThemeReorder(); }

	// ── Langpress-meny på tema-rad ────────────────────────────────────────
	let themeMenuId = $state<string | null>(null);
	let themeMenuName = $state('');
	let themeRowPressTimer: ReturnType<typeof setTimeout> | null = null;
	let themeRowPressTriggered = false;
	let themeActionBusy = $state(false);

	function startThemeRowPress(theme: { id: string; name: string }) {
		themeRowPressTriggered = false;
		themeRowPressTimer = setTimeout(() => {
			themeRowPressTriggered = true; themeMenuId = theme.id; themeMenuName = theme.name;
			if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
		}, 500);
	}
	function cancelThemeRowPress() { if (themeRowPressTimer !== null) { clearTimeout(themeRowPressTimer); themeRowPressTimer = null; } }
	function closeThemeMenu() { themeMenuId = null; }
	function handleThemeRowClick(theme: { id: string }) {
		if (themeRowPressTriggered) { themeRowPressTriggered = false; return; }
		themePanelOpen = false; startNavMetric('home', 'tema'); void goto(`/tema/${theme.id}`);
	}
	async function archiveThemeFromMenu(id: string) {
		themeActionBusy = true;
		try { if (await archiveTheme(id)) themes = themes.filter((t) => t.id !== id); }
		finally { themeActionBusy = false; closeThemeMenu(); }
	}
	async function deleteThemeFromMenu(id: string, name: string) {
		if (!confirm(`Slette temaet «${name}» permanent? Dette kan ikke angres.`)) return;
		themeActionBusy = true;
		try { if (await deleteTheme(id)) themes = themes.filter((t) => t.id !== id); }
		finally { themeActionBusy = false; closeThemeMenu(); }
	}

	// ── Tema-panel longpress ──────────────────────────────────────────────
	let themePanelOpen = $state(false);
	let temaPressTimer: ReturnType<typeof setTimeout> | null = null;
	let temaPressBlocked = false;

	function handleTemaPressStart(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		temaPressTimer = setTimeout(() => { temaPressBlocked = true; themePanelOpen = true; }, 500);
	}
	function handleTemaPressEnd() {
		if (temaPressTimer) { clearTimeout(temaPressTimer); temaPressTimer = null; }
		if (temaPressBlocked) setTimeout(() => { temaPressBlocked = false; }, 50);
	}

	// ── Sensor-data + widgets ─────────────────────────────────────────────
	let sensorSummary = $state<SensorSummary | null>(null);
	let pinnedWidgets = $state<UserWidget[]>([]);
	let hiddenWidgets = $state<UserWidget[]>([]);
	let widgetsLoading = $state(true);
	let configWidget = $state<UserWidget | null>(null);
	let widgetPanelOpen = $state(false);

	async function loadSensorAndWidgets(useCache: boolean) {
		if (useCache) {
			const cachedSummary = readCachedPayload<SensorSummary>(HOME_SENSOR_CACHE_KEY, HOME_SENSOR_CACHE_MAX_AGE_MS);
			if (cachedSummary) { sensorSummary = cachedSummary; widgetsLoading = false; }
			const cachedPinned = readCachedPayload<UserWidget[]>(HOME_PINNED_WIDGETS_CACHE_KEY, HOME_PINNED_WIDGETS_CACHE_MAX_AGE_MS);
			if (cachedPinned && cachedPinned.length > 0) { pinnedWidgets = cachedPinned; scheduleWidgetDataPrefetch(cachedPinned, prefetchWidgetData); widgetsLoading = false; }
		}
		try {
			const data = await timeAsync('sensor+widgets parallel', () => fetchSensorAndWidgets());
			if (data.sensorSummary) { sensorSummary = data.sensorSummary; writeCachedPayload(HOME_SENSOR_CACHE_KEY, sensorSummary); }
			pinnedWidgets = data.pinnedWidgets; hiddenWidgets = data.hiddenWidgets;
			writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		} catch { /* Stille feil */ }
		finally { widgetsLoading = false; }
	}

	// ── Sjekklister ───────────────────────────────────────────────────────
	let activeChecklists = $state<Checklist[]>([]);
	let allContextChecklists = $state<Checklist[]>([]);
	let monthDayChecklists = $state<Checklist[]>([]);
	let monthMetrics = $state<{ effort: Record<string, number>; egenfrekvens: Record<string, number> } | null>(null);
	let openChecklist = $state<Checklist | null>(null);
	let todaysRoutines = $state<Array<{ checklistId: string; title: string; emoji: string; slot: string; items: Array<{ id: string; text: string; checked: boolean; sortOrder: number; estimateMinutes: number | null }> }>>([]);

	async function fetchChecklists() {
		try {
			const data = await fetchChecklistData();
			activeChecklists = data.activeChecklists; allContextChecklists = data.allContextChecklists;
			monthDayChecklists = data.monthDayChecklists;
			if (data.monthMetrics) monthMetrics = data.monthMetrics;
			todaysRoutines = data.todaysRoutines;
		} catch { /* stille */ }
	}

	// ── Handlingssone ─────────────────────────────────────────────────────
	let serverActionCandidates = $state<ActionCandidate[]>([]);
	async function loadActionCandidates() { serverActionCandidates = await fetchActionCandidates(); }

	const actionItems = $derived.by<ActionItem[]>(() =>
		serverActionCandidates.map((c) => ({ id: c.id, icon: c.icon, label: c.label, value: c.value, done: false, priority: c.priority, onclick: () => dispatchActionIntent(c.intent) }))
	);

	// ── Egenfrekvens ──────────────────────────────────────────────────────
	let egenfrekvensRecent = $state<{ today: { morning: EgenfrekvensSlotSummary | null; evening: EgenfrekvensSlotSummary | null }; points: EgenfrekvensRecentPoint[]; settings: { enabled: boolean; morningTime: string; eveningTime: string } | null; } | null>(null);
	let egenfrekvensFlowOpen = $state(false);
	let egenfrekvensQuickFlowOpen = $state(false);
	let egenfrekvensActiveSlot = $state<'morning' | 'evening'>('morning');
	let egenfrekvensPromptOpen = $state(false);
	let egenfrekvensPromptDay = $state('');
	let egenfrekvensInitialNote = $state('');
	let egenfrekvensReflectionPrompt = $state<string | null>(null);
	let egenfrekvensDreamReasons = $state<Record<string, Array<{ value: string; label: string; source: string }>> | null>(null);
	let egenfrekvensCarriedLevel = $state<number | null>(null);

	async function loadEgenfrekvensRecent() { egenfrekvensRecent = await fetchEgenfrekvensRecent(); }
	async function loadEgenfrekvensContext() {
		const ctx = await fetchEgenfrekvensContext(egenfrekvensActiveSlot);
		egenfrekvensReflectionPrompt = ctx.reflectionPrompt; egenfrekvensDreamReasons = ctx.dreamReasons;
	}

	function openEgenfrekvensFlow(initialNote = '', preserveConversation = false) {
		egenfrekvensInitialNote = initialNote.trim(); returnToChatAfterFlow = preserveConversation;
		if (!preserveConversation) chatOpen = false;
		chatInputAutoFocus = false; egenfrekvensFlowOpen = true; void loadEgenfrekvensContext();
	}
	function openEgenfrekvensQuick(slot: 'morning' | 'evening') { egenfrekvensActiveSlot = slot; egenfrekvensQuickFlowOpen = true; }
	function openEgenfrekvensFull(slot: 'morning' | 'evening') { egenfrekvensActiveSlot = slot; egenfrekvensFlowOpen = true; void loadEgenfrekvensContext(); }

	// ── Planlegging ───────────────────────────────────────────────────────
	let homeDayPlanOpen = $state(false);
	let homeDayPlanIso = $state('');
	let homeDayPlanWeekKey = $state('');
	let homeWeekPlanOpen = $state(false);
	let homeWeekPlanContext = $state<import('$lib/flows/types').FlowContext>({});
	let homeMonthPlanOpen = $state(false);
	let homeMonthPlanContext = $state<import('$lib/flows/types').FlowContext>({});

	async function handleChecklistPlan(context: string | null) {
		if (!context) return;
		const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) { homeDayPlanWeekKey = dayMatch[1]; homeDayPlanIso = dayMatch[2]; homeDayPlanOpen = true; return; }
		const weekMatch = context.match(/^week:(\d{4}-W\d{2})$/);
		if (weekMatch) { await openWeekPlan(weekMatch[1]); return; }
		if (/^month:/.test(context)) await openMonthPlan(context.replace('month:', ''));
	}

	async function openWeekPlan(weekKey: string) {
		const ctx = await fetchWeekPlanContext(weekKey);
		if (!ctx) { void goto('/ukeplan'); return; }
		homeWeekPlanContext = buildWeekPlanFlowContext(ctx); homeWeekPlanOpen = true;
	}

	async function openMonthPlan(monthKey: string) {
		const ctx = await fetchMonthPlanContext(monthKey);
		if (!ctx) { void goto('/maanedsplan'); return; }
		homeMonthPlanContext = buildMonthPlanFlowContext(ctx); homeMonthPlanOpen = true;
	}

	// ── Fokustimer / refleksjon / inbox / quick win ──────────────────────
	let focusTimerFlowOpen = $state(false);
	let reflectionLightFlowOpen = $state(false);
	let inboxNoteFlowOpen = $state(false);
	let quickWinFlowOpen = $state(false);
	let quickWinOpenItems = $state<Array<{ id: string; text: string }>>([]);

	async function openQuickWin() {
		const items = await fetchQuickWinItems();
		if (items.length === 0) return;
		quickWinOpenItems = items; quickWinFlowOpen = true;
	}

	// ── Action dispatch ───────────────────────────────────────────────────
	function dispatchActionIntent(intent: ActionIntent): void {
		switch (intent.kind) {
			case 'open-flow':
				if (intent.flowId === 'jobb_focus_timer') focusTimerFlowOpen = true;
				else if (intent.flowId === 'reflection_light') reflectionLightFlowOpen = true;
				else if (intent.flowId === 'quick_win') void openQuickWin();
				else if (intent.flowId === 'inbox_note') inboxNoteFlowOpen = true;
				else if (intent.flowId === 'egenfrekvens_quick') { egenfrekvensActiveSlot = currentSlotFromTime(); egenfrekvensQuickFlowOpen = true; }
				else if (intent.flowId === 'egenfrekvens_checkin') { egenfrekvensActiveSlot = currentSlotFromTime(); egenfrekvensFlowOpen = true; void loadEgenfrekvensContext(); }
				else console.warn('[home] unhandled flow intent', intent.flowId);
				break;
			case 'open-egenfrekvens': openEgenfrekvensQuick(intent.slot); break;
			case 'open-day-plan': homeDayPlanIso = intent.iso; homeDayPlanWeekKey = intent.weekKey; homeDayPlanOpen = true; break;
			case 'open-week-plan': void openWeekPlan(intent.weekKey); break;
			case 'open-month-plan': void openMonthPlan(intent.monthKey); break;
			case 'navigate': void goto(intent.href); break;
		}
	}

	// ── Snooze-meny (delegert til home-conversations.ts) ──────────────────
	let snoozeMenuChipId = $state<string | null>(null);
	let snoozeMenuLabel = $state('');
	const snoozeState = { get snoozeMenuChipId() { return snoozeMenuChipId; }, set snoozeMenuChipId(v) { snoozeMenuChipId = v; }, get snoozeMenuLabel() { return snoozeMenuLabel; }, set snoozeMenuLabel(v) { snoozeMenuLabel = v; } };

	function startLongPress(chipId: string, label: string, e: PointerEvent) { longPressStart(snoozeState, chipId, label, e); }
	function cancelLongPress() { longPressCancel(); }
	function handleChipClick(onclick: () => void) { chipClickHandler(onclick); }
	function closeSnoozeMenu() { snoozeMenuClose(snoozeState); }
	async function snoozeChip(scope: 'today' | 'week' | 'forever') { await snoozeChipHandler(snoozeState, scope, loadActionCandidates); }

	// ── Chat-sone ─────────────────────────────────────────────────────────
	let chatOpen = $state(false);
	let chatPrefill = $state('');
	let latestClosedConversationId = $state<string | null>(null);
	let createdThemeLink = $state<{ id: string; name: string; emoji?: string | null } | null>(null);
	let launchingThemeId = $state<string | null>(null);
	let chatInputAutoFocus = $state(false);
	let returnToChatAfterFlow = $state(false);
	let selectedChatModel = $state<string>((typeof localStorage !== 'undefined' && localStorage.getItem('chat-model')) || 'auto');
	let suggestedTheme = $state<{ themeId: string; themeName: string; confidence: string; reasoning?: string } | null>(null);
	let routedToTheme = $state<{ themeId: string; themeName: string } | null>(null);
	let chatSection: HTMLElement | null = $state(null);

	const homeChat = new ChatState({
		getOrCreateConversationId: async () => { const res = await fetch('/api/conversations/new', { method: 'POST' }); if (!res.ok) return null; return (await res.json()).conversationId ?? null; },
		preferredModel: () => selectedChatModel !== 'auto' ? selectedChatModel : undefined,
		onPayload: (data) => {
			const theme = data.themeCreated && data.theme && typeof data.theme === 'object' ? data.theme as { id?: string; name?: string; emoji?: string | null } : null;
			if (theme?.id) createdThemeLink = { id: theme.id, name: theme.name ?? '', emoji: theme.emoji ?? null };
		},
		onThemeRouted: (theme) => { routedToTheme = theme; },
		onThemeSuggested: (theme) => { suggestedTheme = theme; },
		onBookRouted: (book) => { closeChat(); goto(`/tema/${book.themeId}?tab=books&bookId=${book.bookId}`); },
		onChecklistChanged: fetchChecklists,
	});

	// ── Samtale-liste (delegert til home-conversations.ts) ────────────────
	let homeConversationList = $state(recentConversations);
	let homeEditingConversationId = $state<string | null>(null);
	let homeEditingTitle = $state('');
	$effect(() => { homeConversationList = recentConversations; });

	const convoState = {
		get homeConversationList() { return homeConversationList; }, set homeConversationList(v) { homeConversationList = v; },
		get homeEditingConversationId() { return homeEditingConversationId; }, set homeEditingConversationId(v) { homeEditingConversationId = v; },
		get homeEditingTitle() { return homeEditingTitle; }, set homeEditingTitle(v) { homeEditingTitle = v; },
	};

	let selectedQuickAction = $state<QuickActionId>('chat');
	const activeQuickAction = $derived(QUICK_ACTIONS.find((action) => action.id === selectedQuickAction) ?? QUICK_ACTIONS[0]);
	const hasPersistedConversation = $derived(Boolean(homeChat.conversationId));
	const chatConversationTitle = $derived.by(() => {
		if (!hasPersistedConversation) return '';
		const firstUserMessage = homeChat.messages.find((msg) => msg.role === 'user' && msg.text && msg.text !== '📷 [Bilde]');
		const base = firstUserMessage?.text?.trim() || 'Ny samtale';
		return base.length > 42 ? `${base.slice(0, 42).trimEnd()}…` : base;
	});

	const followUpConversations = $derived.by(() => {
		const activeId = homeChat.conversationId || latestClosedConversationId;
		return homeConversationList.filter((c) => c.id !== activeId).slice(0, 6);
	});
	const followUpStarred = $derived(followUpConversations.filter((c) => c.starred && !c.archived));
	const followUpRegular = $derived(followUpConversations.filter((c) => !c.starred && !c.archived));

	function openChat(prefill = '', actionId: QuickActionId = selectedQuickAction, options?: { focusInput?: boolean }) {
		selectedQuickAction = actionId; chatPrefill = prefill;
		chatInputAutoFocus = options?.focusInput ?? shouldAutoFocusInput(); chatOpen = true;
	}

	function closeChat() {
		if (homeChat.conversationId && homeChat.messages.length > 0) latestClosedConversationId = homeChat.conversationId;
		homeChat.reset(); homeChat.conversationId = null; chatPrefill = ''; chatInputAutoFocus = false;
		createdThemeLink = null; launchingThemeId = null; chatOpen = false; returnToChatAfterFlow = false;
	}

	async function sendChat(text: string, imageUrl?: string, attachment?: AttachmentRef) {
		suggestedTheme = null; routedToTheme = null;
		await homeChat.send(text, imageUrl, attachment as Parameters<typeof homeChat.send>[2]);
	}

	function stopChat() { homeChat.stop(); }

	function startQuickAction(action: import('./home/home-context').QuickAction) {
		homeChat.reset(); homeChat.conversationId = null; chatPrefill = ''; createdThemeLink = null;
		if (action.id === 'chat') openChat('', 'chat');
		else if (action.id === 'camera') cameraOpen = true;
		else if (action.id === 'voice') voiceOpen = true;
		else if (action.id === 'mood') egenfrekvensFlowOpen = true;
		else if (action.id === 'file') fileFlowOpen = true;
	}

	function openPartnerOnboardingChat() {
		openChat('Vi har nettopp koblet oss som partnere i Resonans. Hjelp oss å sette opp et parforhold-tema, foreslå 3 fokusområder, og lag første ukes mini-plan med konkrete steg.', 'chat');
	}

	function startHomeChat(draftOverride?: string) {
		const draft = (draftOverride ?? chatPrefill).trim();
		if (!draft) { openChat('', 'chat', { focusInput: true }); return; }
		chatPrefill = ''; openChat('', 'chat', { focusInput: false }); void sendChat(draft);
	}

	function startHomeAttachment(kind: 'camera' | 'voice' | 'file', draftOverride?: string, options?: { preserveConversation?: boolean }) {
		const draft = (draftOverride ?? chatPrefill).trim();
		if (!options?.preserveConversation) { homeChat.reset(); homeChat.conversationId = null; createdThemeLink = null; }
		returnToChatAfterFlow = Boolean(options?.preserveConversation);
		chatOpen = false; chatInputAutoFocus = false;
		if (kind === 'camera') { cameraCaption = draft; cameraOpen = true; return; }
		if (kind === 'voice') { voiceText = draft; voiceOpen = true; return; }
		fileFlowMode = 'local'; fileFlowNote = draft; fileFlowOpen = true;
	}

	// ── Kamera-flyt (state + delegert til home-media.ts) ──────────────────
	let cameraOpen = $state(false);
	let cameraFileInput = $state<HTMLInputElement | null>(null);
	let cameraSelectedFile = $state<File | null>(null);
	let cameraPreview = $state<string | null>(null);
	let cameraCaption = $state('');
	let cameraUploading = $state(false);
	let cameraError = $state(false);
	let cameraHistory = $state<MediaHistoryItem[]>([]);
	let cameraHistoryLoading = $state(false);

	// ── Lyd-flyt ──────────────────────────────────────────────────────────
	let voiceOpen = $state(false);
	let voiceText = $state('');
	let voiceFileInput = $state<HTMLInputElement | null>(null);
	let voiceSelectedFile = $state<File | null>(null);
	let voiceUploading = $state(false);
	let voiceError = $state(false);
	let voiceHistory = $state<MediaHistoryItem[]>([]);
	let voiceHistoryLoading = $state(false);

	// ── Fil-flyt ──────────────────────────────────────────────────────────
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
	let fileHistory = $state<MediaHistoryItem[]>([]);
	let fileHistoryLoading = $state(false);

	// Media-flyt handlers bruker ctx (definert i setContext nedenfor) som state-bærer.
	// ctx har getter/setter-par som proxyer til $state-variablene ovenfor.
	// Vi deklarerer ctx-referansen her og tildeler den i setContext-blokken.
	let ctx: HomeContext;

	function handleCameraFileSelect(event: Event) { cameraFileSelectHandler(ctx, event); }
	function closeCameraFlow() { cameraCloseHandler(ctx, returnToChatAfterFlow, (v) => chatOpen = v, (v) => chatInputAutoFocus = v, (v) => returnToChatAfterFlow = v); }
	async function submitCamera() { await cameraSubmitHandler(ctx, homeChat, pendingActionHandlers, sendChat, closeCameraFlow, (v) => selectedQuickAction = v, (v) => chatOpen = v, (v) => returnToChatAfterFlow = v, (v) => chatPrefill = v); }
	async function reuseCameraMedia(item: MediaHistoryItem) { await cameraReuseHandler(ctx, item); }
	function handleVoiceFileSelect(event: Event) { voiceFileSelectHandler(ctx, event); }
	function closeVoiceFlow() { voiceCloseHandler(ctx, returnToChatAfterFlow, (v) => chatOpen = v, (v) => chatInputAutoFocus = v, (v) => returnToChatAfterFlow = v); }
	async function submitVoice() { await voiceSubmitHandler(ctx, homeChat, pendingActionHandlers, sendChat, closeVoiceFlow, (v) => selectedQuickAction = v, (v) => chatOpen = v, (v) => returnToChatAfterFlow = v, (v) => chatPrefill = v); }
	async function reuseVoiceMedia(item: MediaHistoryItem) { await voiceReuseHandler(ctx, item); }
	function handleFileFlowSelect(event: Event) { fileFlowSelectHandler(ctx, event); }
	function closeFileFlow() { fileCloseHandler(ctx, returnToChatAfterFlow, (v) => chatOpen = v, (v) => chatInputAutoFocus = v, (v) => returnToChatAfterFlow = v); }
	function submitFile() { fileSubmitHandler(ctx, homeChat, pendingActionHandlers, sendChat, closeFileFlow, (v) => selectedQuickAction = v, (v) => chatOpen = v, (v) => returnToChatAfterFlow = v, (v) => chatPrefill = v); }
	async function submitSheetSnapshot() { await sheetSnapshotHandler(ctx, homeChat, pendingActionHandlers, sendChat, closeFileFlow, (v) => selectedQuickAction = v, (v) => chatOpen = v, (v) => returnToChatAfterFlow = v, (v) => chatPrefill = v); }
	async function reuseFileMedia(item: MediaHistoryItem) { await fileReuseHandler(ctx, item); }

	let pendingActionHandlers: Record<string, () => void> = {};

	// ── Deriverte verdier ─────────────────────────────────────────────────
	const inputExpanded = $derived(chatOpen || cameraOpen || voiceOpen || fileFlowOpen);
	const dateLabel = $derived(new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(new Date()));

	const metricWidgetEntries = $derived.by<HomeWidgetEntry[]>(() => {
		if (widgetsLoading) return Array.from({ length: 3 }, (_, i) => ({ id: `skeleton:${i}`, kind: 'skeleton', skeletonIndex: i }));
		if (pinnedWidgets.length > 0) return pinnedWidgets.map((widget) => ({ id: `dynamic:${widget.id}`, kind: 'dynamic' as const, widget }));
		if (relationshipOnboardingActive) return [{ id: 'partner-onboarding', kind: 'partner' }];
		return [];
	});

	const monthDayData = $derived.by(() => {
		const now = new Date(); const year = now.getFullYear(); const month = now.getMonth() + 1;
		const daysInMonth = new Date(year, month, 0).getDate(); const todayDay = now.getDate();
		const byDate = new Map<string, Checklist>();
		for (const c of monthDayChecklists) { const m = (c.context ?? '').match(/:day:(\d{4}-\d{2}-\d{2})$/); if (m) byDate.set(m[1], c); }
		return Array.from({ length: daysInMonth }, (_, i) => {
			const dayNum = i + 1; const isPast = dayNum < todayDay; const isToday = dayNum === todayDay;
			const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
			const effort = monthMetrics?.effort[iso]; const egenfrekvens = monthMetrics?.egenfrekvens[iso]; const cl = byDate.get(iso);
			if (!cl || !(isPast || isToday)) return { planned: 0, completed: 0, effort, egenfrekvens, isPast, isToday };
			const items = cl.items.filter((it) => { if (it.skippedAt) return false; if (it.parentId) return true; return !cl.items.some((c2) => c2.parentId === it.id); });
			return { planned: items.length, completed: items.filter((it) => it.checked).length, effort, egenfrekvens, isPast, isToday };
		});
	});

	const homeWidgetEntries = $derived.by<HomeWidgetEntry[]>(() => {
		const now = new Date();
		const monthCtx = `month:${toLocalYearMonth(now)}`; const weekCtx = `week:${getLocalIsoWeekDashed(now)}`; const dayCtx = `week:${getLocalIsoWeekDashed(now)}:day:${toLocalIsoDate(now)}`;
		const orderedChecklists: HomeWidgetEntry[] = [monthCtx, weekCtx, dayCtx].map((ctx) => {
			const existing = activeChecklists.find((c) => c.context === ctx) ?? allContextChecklists.find((c) => c.context === ctx);
			const checklist = existing ?? { id: `synthetic:${ctx}`, title: '', emoji: '📅', context: ctx, completedAt: null, items: [] };
			return { id: existing ? `checklist:${existing.id}` : `synthetic:${ctx}`, kind: 'checklist' as const, checklist };
		});
		return [...orderedChecklists, ...metricWidgetEntries];
	});

	const homeWidgetPages = $derived(chunkWidgets(homeWidgetEntries, WIDGETS_PER_PAGE));
	let widgetPagerEl = $state<HTMLElement | null>(null);
	let currentWidgetPage = $state(0);

	$effect(() => { const total = homeWidgetPages.length; if (total === 0) { currentWidgetPage = 0; return; } if (currentWidgetPage > total - 1) currentWidgetPage = total - 1; });

	function handleWidgetPagerScroll() { if (!widgetPagerEl) return; const width = widgetPagerEl.clientWidth; if (width <= 0) return; currentWidgetPage = Math.round(widgetPagerEl.scrollLeft / width); }
	function goToWidgetPage(index: number) { if (!widgetPagerEl) return; const clamped = Math.max(0, Math.min(index, homeWidgetPages.length - 1)); widgetPagerEl.scrollTo({ left: clamped * widgetPagerEl.clientWidth, behavior: 'smooth' }); currentWidgetPage = clamped; }

	// ── Widget-operasjoner ────────────────────────────────────────────────
	function openWidgetConfigSheet(widget: UserWidget) { widgetPanelOpen = false; configWidget = widget; }

	async function unpinWidget(id: string) {
		const widget = pinnedWidgets.find((w) => w.id === id); pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		if (widget) hiddenWidgets = [widget, ...hiddenWidgets]; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		const res = await fetch(`/api/user-widgets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: false }) });
		if (!res.ok && widget) { hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id); pinnedWidgets = [widget, ...pinnedWidgets]; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets); }
	}

	async function repinWidget(id: string) {
		const widget = hiddenWidgets.find((w) => w.id === id); hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id);
		if (widget) pinnedWidgets = [...pinnedWidgets, { ...widget, pinned: true }]; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		const res = await fetch(`/api/user-widgets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: true }) });
		if (!res.ok && widget) { pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id); hiddenWidgets = [widget, ...hiddenWidgets]; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets); }
	}

	async function moveWidget(id: string, direction: 'up' | 'down') {
		const index = pinnedWidgets.findIndex((w) => w.id === id); if (index === -1) return;
		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= pinnedWidgets.length) return;
		const next = [...pinnedWidgets]; [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
		pinnedWidgets = next; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		await Promise.all(next.map((widget, i) => fetch(`/api/user-widgets/${widget.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: i }) })));
	}

	async function deleteWidget(id: string) {
		const inPinned = pinnedWidgets.find((w) => w.id === id); const inHidden = hiddenWidgets.find((w) => w.id === id);
		if (inPinned) pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		if (inHidden) hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id);
		writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		const res = await fetch(`/api/user-widgets/${id}`, { method: 'DELETE' });
		if (!res.ok) { if (inPinned) pinnedWidgets = [...pinnedWidgets, inPinned]; if (inHidden) hiddenWidgets = [...hiddenWidgets, inHidden]; writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets); }
	}

	async function saveWidgetConfig(id: string, updates: Partial<UserWidget>) {
		configWidget = null;
		const res = await fetch(`/api/user-widgets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
		if (res.ok) { const updated = await res.json(); pinnedWidgets = pinnedWidgets.map((w) => w.id === id ? { ...w, ...updated } : w); hiddenWidgets = hiddenWidgets.map((w) => w.id === id ? { ...w, ...updated } : w); writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets); }
	}

	function navigateForWidget(w: UserWidget) {
		const healthMetrics = ['weight', 'sleepDuration', 'steps', 'distance', 'workoutCount', 'heartrate', 'mood'];
		const econMetrics = ['amount'];
		if (healthMetrics.includes(w.metricType)) { const t = themes.find((t) => t.name.trim().toLowerCase() === 'helse'); if (t) { startNavMetric('home', 'tema'); void goto(`/tema/${t.id}`); } }
		else if (econMetrics.includes(w.metricType)) { const t = themes.find((t) => t.name.trim().toLowerCase() === 'økonomi'); startNavMetric('home', 'tema'); void goto(t ? `/tema/${t.id}` : '/economics'); }
		else void goto('/');
	}

	async function openCreatedTheme(themeId: string) { launchingThemeId = themeId; await goto(`/tema/${themeId}?handoff=1`); }

	// ── Pull to refresh ───────────────────────────────────────────────────
	async function refreshHomeData() { await Promise.allSettled([fetchChecklists(), loadSensorAndWidgets(false)]); }

	// ── Media history loading effects ─────────────────────────────────────
	$effect(() => { if (cameraOpen) { cameraHistoryLoading = true; fetchMediaHistory('image').then((h) => { cameraHistory = h; cameraHistoryLoading = false; }); } });
	$effect(() => { if (voiceOpen) { voiceHistoryLoading = true; fetchMediaHistory('audio').then((h) => { voiceHistory = h; voiceHistoryLoading = false; }); } });
	$effect(() => { if (fileFlowOpen) { fileHistoryLoading = true; fetchMediaHistory('document').then((h) => { fileHistory = h; fileHistoryLoading = false; }); } });

	// ── iOS keyboard scroll fix ───────────────────────────────────────────
	$effect(() => {
		if (!inputExpanded) return;
		if (typeof window === 'undefined' || !window.visualViewport) return;
		const vv = window.visualViewport;
		function updateLayout() { if (!chatSection) return; chatSection.style.height = `${vv.height}px`; chatSection.style.top = `${vv.offsetTop}px`; }
		vv.addEventListener('resize', updateLayout); vv.addEventListener('scroll', updateLayout); updateLayout();
		return () => { vv.removeEventListener('resize', updateLayout); vv.removeEventListener('scroll', updateLayout); if (chatSection) { chatSection.style.height = ''; chatSection.style.top = ''; } };
	});

	// ── onMount ───────────────────────────────────────────────────────────
	onMount(() => {
		void (async () => {
			finishNavMetric('home');
			const checklistPromise = timeAsync('checklists', () => fetchChecklists());
			await loadSensorAndWidgets(true); await checklistPromise;

			if (typeof window !== 'undefined') {
				const runPreload = () => { void preloadCode('/tema/*'); for (const theme of themes.slice(0, 2)) void preloadData(`/tema/${theme.id}`); };
				if ('requestIdleCallback' in window) window.requestIdleCallback(runPreload, { timeout: 1200 }); else setTimeout(runPreload, 180);
			}

			if ($page.url.searchParams.get('chat') === '1') openChat();
			void loadEgenfrekvensRecent(); void loadActionCandidates();

			const flowParam = $page.url.searchParams.get('flow');
			if (flowParam === 'egenfrekvens_checkin' || flowParam === 'egenfrekvens_quick') {
				const fromUrl = $page.url.searchParams.get('slot');
				egenfrekvensActiveSlot = (fromUrl === 'morning' || fromUrl === 'evening') ? fromUrl : currentSlotFromTime();
				if (flowParam === 'egenfrekvens_checkin') { egenfrekvensFlowOpen = true; void loadEgenfrekvensContext(); } else egenfrekvensQuickFlowOpen = true;
				const nudgeId = $page.url.searchParams.get('nudgeEventId');
				if (nudgeId) void fetch(`/api/nudges/events/${nudgeId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'flow_started' }) }).catch(() => {});
			}

			// App-open egenfrekvens prompt
			void (async () => {
				try {
					const isoDay = new Date().toISOString().slice(0, 10);
					const res = await fetch(`/api/egenfrekvens/status?day=${isoDay}`);
					if (!res.ok) return;
					const status = await res.json();
					if (!status.settings || status.settings.enabled === false) return;
					if (typeof localStorage !== 'undefined' && localStorage.getItem(`egenfrekvens-prompt-dismissed-${status.day}`)) return;
					const morning = status.settings.morningTime ?? '06:30'; const evening = status.settings.eveningTime ?? '21:00';
					const count = typeof status.count === 'number' ? status.count : status.submitted ? 1 : 0;
					const nowHm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
					const showMorning = nowHm >= morning && count === 0; const showEvening = nowHm >= evening && count < 2;
					if (!showMorning && !showEvening) return;
					egenfrekvensPromptDay = status.day; egenfrekvensPromptOpen = true;
				} catch { /* best-effort */ }
			})();
		})();
	});

	// ── Publiser kontekst til sone-komponenter ────────────────────────────
	ctx = {
		get themes() { return themes; }, set themes(v) { themes = v; },
		get relationshipOnboardingActive() { return relationshipOnboardingActive; },
		get relationshipTheme() { return relationshipTheme; },

		get dragThemeId() { return dragThemeId; }, set dragThemeId(v) { dragThemeId = v; },
		get dropIndex() { return dropIndex; }, set dropIndex(v) { dropIndex = v; },
		get isTouchDrag() { return isTouchDrag; }, set isTouchDrag(v) { isTouchDrag = v; },
		get themeListEl() { return themeListEl; }, set themeListEl(v) { themeListEl = v; },
		get touchChip() { return touchChip; }, set touchChip(v) { touchChip = v; },
		get draggedTheme() { return draggedTheme; },
		get displayList() { return displayList; },

		get themeMenuId() { return themeMenuId; }, set themeMenuId(v) { themeMenuId = v; },
		get themeMenuName() { return themeMenuName; }, set themeMenuName(v) { themeMenuName = v; },
		get themeActionBusy() { return themeActionBusy; }, set themeActionBusy(v) { themeActionBusy = v; },
		get themePanelOpen() { return themePanelOpen; }, set themePanelOpen(v) { themePanelOpen = v; },
		get temaPressBlocked() { return temaPressBlocked; },

		get pinnedWidgets() { return pinnedWidgets; }, set pinnedWidgets(v) { pinnedWidgets = v; },
		get hiddenWidgets() { return hiddenWidgets; }, set hiddenWidgets(v) { hiddenWidgets = v; },
		get widgetsLoading() { return widgetsLoading; },
		get configWidget() { return configWidget; }, set configWidget(v) { configWidget = v; },
		get widgetPanelOpen() { return widgetPanelOpen; }, set widgetPanelOpen(v) { widgetPanelOpen = v; },
		get homeWidgetPages() { return homeWidgetPages; },
		get widgetPagerEl() { return widgetPagerEl; }, set widgetPagerEl(v) { widgetPagerEl = v; },
		get currentWidgetPage() { return currentWidgetPage; }, set currentWidgetPage(v) { currentWidgetPage = v; },

		get activeChecklists() { return activeChecklists; }, set activeChecklists(v) { activeChecklists = v; },
		get allContextChecklists() { return allContextChecklists; }, set allContextChecklists(v) { allContextChecklists = v; },
		get monthDayChecklists() { return monthDayChecklists; },
		get monthMetrics() { return monthMetrics; },
		get openChecklist() { return openChecklist; }, set openChecklist(v) { openChecklist = v; },
		get todaysRoutines() { return todaysRoutines; },
		get monthDayData() { return monthDayData; },

		get chatOpen() { return chatOpen; }, set chatOpen(v) { chatOpen = v; },
		get chatPrefill() { return chatPrefill; }, set chatPrefill(v) { chatPrefill = v; },
		get chatInputAutoFocus() { return chatInputAutoFocus; }, set chatInputAutoFocus(v) { chatInputAutoFocus = v; },
		get chatSection() { return chatSection; }, set chatSection(v) { chatSection = v; },
		get inputExpanded() { return inputExpanded; },
		get homeChat() { return homeChat; },
		get selectedQuickAction() { return selectedQuickAction; }, set selectedQuickAction(v) { selectedQuickAction = v; },
		get activeQuickAction() { return activeQuickAction; },
		get hasPersistedConversation() { return hasPersistedConversation; },
		get chatConversationTitle() { return chatConversationTitle; },
		get latestClosedConversationId() { return latestClosedConversationId; }, set latestClosedConversationId(v) { latestClosedConversationId = v; },
		get createdThemeLink() { return createdThemeLink; }, set createdThemeLink(v) { createdThemeLink = v; },
		get launchingThemeId() { return launchingThemeId; }, set launchingThemeId(v) { launchingThemeId = v; },
		get returnToChatAfterFlow() { return returnToChatAfterFlow; }, set returnToChatAfterFlow(v) { returnToChatAfterFlow = v; },
		get selectedChatModel() { return selectedChatModel; }, set selectedChatModel(v) { selectedChatModel = v; },
		get suggestedTheme() { return suggestedTheme; }, set suggestedTheme(v) { suggestedTheme = v; },
		get routedToTheme() { return routedToTheme; }, set routedToTheme(v) { routedToTheme = v; },
		get homeConversationList() { return homeConversationList; }, set homeConversationList(v) { homeConversationList = v; },
		get homeEditingConversationId() { return homeEditingConversationId; }, set homeEditingConversationId(v) { homeEditingConversationId = v; },
		get homeEditingTitle() { return homeEditingTitle; }, set homeEditingTitle(v) { homeEditingTitle = v; },
		get followUpConversations() { return followUpConversations; },
		get followUpStarred() { return followUpStarred; },
		get followUpRegular() { return followUpRegular; },

		get actionItems() { return actionItems; },
		get serverActionCandidates() { return serverActionCandidates; },

		get snoozeMenuChipId() { return snoozeMenuChipId; }, set snoozeMenuChipId(v) { snoozeMenuChipId = v; },
		get snoozeMenuLabel() { return snoozeMenuLabel; }, set snoozeMenuLabel(v) { snoozeMenuLabel = v; },

		get cameraOpen() { return cameraOpen; }, set cameraOpen(v) { cameraOpen = v; },
		get cameraFileInput() { return cameraFileInput; }, set cameraFileInput(v) { cameraFileInput = v; },
		get cameraSelectedFile() { return cameraSelectedFile; }, set cameraSelectedFile(v) { cameraSelectedFile = v; },
		get cameraPreview() { return cameraPreview; }, set cameraPreview(v) { cameraPreview = v; },
		get cameraCaption() { return cameraCaption; }, set cameraCaption(v) { cameraCaption = v; },
		get cameraUploading() { return cameraUploading; },
		get cameraError() { return cameraError; },
		get cameraHistory() { return cameraHistory; },
		get cameraHistoryLoading() { return cameraHistoryLoading; },

		get voiceOpen() { return voiceOpen; }, set voiceOpen(v) { voiceOpen = v; },
		get voiceText() { return voiceText; }, set voiceText(v) { voiceText = v; },
		get voiceFileInput() { return voiceFileInput; }, set voiceFileInput(v) { voiceFileInput = v; },
		get voiceSelectedFile() { return voiceSelectedFile; }, set voiceSelectedFile(v) { voiceSelectedFile = v; },
		get voiceUploading() { return voiceUploading; },
		get voiceError() { return voiceError; }, set voiceError(v) { voiceError = v; },
		get voiceHistory() { return voiceHistory; },
		get voiceHistoryLoading() { return voiceHistoryLoading; },

		get fileFlowOpen() { return fileFlowOpen; }, set fileFlowOpen(v) { fileFlowOpen = v; },
		get fileFlowInput() { return fileFlowInput; }, set fileFlowInput(v) { fileFlowInput = v; },
		get fileFlowSelected() { return fileFlowSelected; }, set fileFlowSelected(v) { fileFlowSelected = v; },
		get fileFlowMode() { return fileFlowMode; }, set fileFlowMode(v) { fileFlowMode = v; },
		get fileFlowNote() { return fileFlowNote; }, set fileFlowNote(v) { fileFlowNote = v; },
		get fileFlowUploading() { return fileFlowUploading; },
		get fileFlowError() { return fileFlowError; },
		get sheetFlowUrl() { return sheetFlowUrl; }, set sheetFlowUrl(v) { sheetFlowUrl = v; },
		get sheetFlowRange() { return sheetFlowRange; }, set sheetFlowRange(v) { sheetFlowRange = v; },
		get sheetFlowUploading() { return sheetFlowUploading; },
		get sheetFlowError() { return sheetFlowError; },
		get fileHistory() { return fileHistory; },
		get fileHistoryLoading() { return fileHistoryLoading; },

		get egenfrekvensFlowOpen() { return egenfrekvensFlowOpen; }, set egenfrekvensFlowOpen(v) { egenfrekvensFlowOpen = v; },
		get egenfrekvensQuickFlowOpen() { return egenfrekvensQuickFlowOpen; }, set egenfrekvensQuickFlowOpen(v) { egenfrekvensQuickFlowOpen = v; },
		get egenfrekvensActiveSlot() { return egenfrekvensActiveSlot; }, set egenfrekvensActiveSlot(v) { egenfrekvensActiveSlot = v; },
		get egenfrekvensPromptOpen() { return egenfrekvensPromptOpen; }, set egenfrekvensPromptOpen(v) { egenfrekvensPromptOpen = v; },
		get egenfrekvensPromptDay() { return egenfrekvensPromptDay; },
		get egenfrekvensInitialNote() { return egenfrekvensInitialNote; }, set egenfrekvensInitialNote(v) { egenfrekvensInitialNote = v; },
		get egenfrekvensReflectionPrompt() { return egenfrekvensReflectionPrompt; }, set egenfrekvensReflectionPrompt(v) { egenfrekvensReflectionPrompt = v; },
		get egenfrekvensDreamReasons() { return egenfrekvensDreamReasons; }, set egenfrekvensDreamReasons(v) { egenfrekvensDreamReasons = v; },
		get egenfrekvensCarriedLevel() { return egenfrekvensCarriedLevel; }, set egenfrekvensCarriedLevel(v) { egenfrekvensCarriedLevel = v; },
		get egenfrekvensRecent() { return egenfrekvensRecent; },

		get homeDayPlanOpen() { return homeDayPlanOpen; }, set homeDayPlanOpen(v) { homeDayPlanOpen = v; },
		get homeDayPlanIso() { return homeDayPlanIso; }, set homeDayPlanIso(v) { homeDayPlanIso = v; },
		get homeDayPlanWeekKey() { return homeDayPlanWeekKey; }, set homeDayPlanWeekKey(v) { homeDayPlanWeekKey = v; },
		get homeWeekPlanOpen() { return homeWeekPlanOpen; }, set homeWeekPlanOpen(v) { homeWeekPlanOpen = v; },
		get homeWeekPlanContext() { return homeWeekPlanContext; },
		get homeMonthPlanOpen() { return homeMonthPlanOpen; }, set homeMonthPlanOpen(v) { homeMonthPlanOpen = v; },
		get homeMonthPlanContext() { return homeMonthPlanContext; },

		get programReadiness() { return programReadiness; },

		get focusTimerFlowOpen() { return focusTimerFlowOpen; }, set focusTimerFlowOpen(v) { focusTimerFlowOpen = v; },
		get reflectionLightFlowOpen() { return reflectionLightFlowOpen; }, set reflectionLightFlowOpen(v) { reflectionLightFlowOpen = v; },
		get inboxNoteFlowOpen() { return inboxNoteFlowOpen; }, set inboxNoteFlowOpen(v) { inboxNoteFlowOpen = v; },
		get quickWinFlowOpen() { return quickWinFlowOpen; }, set quickWinFlowOpen(v) { quickWinFlowOpen = v; },
		get quickWinOpenItems() { return quickWinOpenItems; },

		get dateLabel() { return dateLabel; },

		openChat, closeChat, startQuickAction, startHomeChat, startHomeAttachment, openPartnerOnboardingChat,
		openEgenfrekvensFlow, openEgenfrekvensQuick, openEgenfrekvensFull, sendChat, stopChat,
		closeCameraFlow, closeVoiceFlow, closeFileFlow,
		handleCameraFileSelect, handleVoiceFileSelect, handleFileFlowSelect,
		submitCamera, submitVoice, submitFile, submitSheetSnapshot,
		handleWidgetPagerScroll, goToWidgetPage, handleChecklistPlan,
		openWidgetConfigSheet, navigateForWidget, unpinWidget, repinWidget, moveWidget, deleteWidget, saveWidgetConfig,
		fetchChecklists, loadActionCandidates, loadEgenfrekvensRecent, loadEgenfrekvensContext,
		dispatchActionIntent, handleChipClick, startLongPress, cancelLongPress, closeSnoozeMenu, snoozeChip,
		handleTemaPressStart, handleTemaPressEnd,
		handleThemeDragStart, handleThemeDragOver, commitThemeReorder,
		handleTouchDragStart, handleTouchDragMove, handleTouchDragEnd, resetDrag,
		startThemeRowPress, cancelThemeRowPress, closeThemeMenu, handleThemeRowClick,
		archiveThemeFromMenu, deleteThemeFromMenu, openCreatedTheme,
		formatFollowUpDate,
		setHomeConversationStarred: (id, starred) => setConversationStarred(convoState, id, starred),
		setHomeConversationArchived: (id, archived) => setConversationArchived(convoState, id, archived),
		removeHomeConversation: (id) => removeConversation(convoState, id),
		moveHomeConversationTheme: (id, themeId) => moveConversationTheme(convoState, id, themeId, themes),
		startHomeConversationRename: (id, currentTitle) => startConversationRename(convoState, id, currentTitle),
		cancelHomeConversationRename: () => cancelConversationRename(convoState),
		commitHomeConversationRename: (id) => commitConversationRename(convoState, id),
		reuseCameraMedia, reuseVoiceMedia, reuseFileMedia,
		refreshHomeData, openWeekPlan, openMonthPlan, openQuickWin,
		pendingActionHandlers, getLocalIsoWeekDashed, toLocalIsoDate,
	};
	setContext(HOME_CTX, ctx);
</script>

<PullToRefresh
	onRefresh={refreshHomeData}
	disabled={inputExpanded || chatOpen || widgetPanelOpen || themePanelOpen}
	excludeSelectors=".widget-pager, .zone-tema, .zone-input, .zone-chat-open"
>
<div
	class="home-screen"
	class:home-screen-chat-open={chatOpen}
>
	<!-- SONE 1: Tittel -->
	<HomeTitleZone />

	<!-- SONE 2: Widgets -->
	<HomeWidgetZone />

	<!-- SONE 3: Tema -->
	<HomeThemeZone />

	<!-- SONE 4: Chat + handlinger -->
	<HomeChatZone />

</div>
</PullToRefresh>

<HomeOverlays />

<style>
	.home-screen {
		height: 100dvh;
		position: relative;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>
