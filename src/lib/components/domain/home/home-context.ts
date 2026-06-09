/**
 * Delt kontekst for hjemskjerm-sonene.
 *
 * HomeScreen setter opp $state-objektet og publiserer det med setContext(HOME_CTX, ...).
 * Hver sone-komponent henter det med getContext<HomeContext>(HOME_CTX).
 *
 * Svelte 5: $state-egenskaper på objektet er reaktive gjennom context uten wrapping.
 */

import type { Checklist } from '../../composed/ChecklistWidget.svelte';
import type { ChatState } from '$lib/client/chat-state.svelte';
import type { ActionCandidate, ActionIntent } from '$lib/types/actions';
import type { FlowContext } from '$lib/flows/types';

export const HOME_CTX = Symbol('home');

// ── Gjenbrukbare typer ──────────────────────────────────────────────────

export interface Theme {
	id: string;
	name: string;
	emoji: string;
}

export interface RecentConversation {
	id: string;
	title: string;
	preview: string;
	starred: boolean;
	archived: boolean;
	linkedTheme: { id: string; name: string; emoji: string | null } | null;
	updatedAt: string;
}

export type QuickActionId = 'chat' | 'camera' | 'voice' | 'mood' | 'file';
type QuickActionIcon = 'chat' | 'camera' | 'wave' | 'checkin' | 'file';

export interface QuickAction {
	id: QuickActionId;
	label: string;
	icon: QuickActionIcon;
	description: string;
	placeholder: string;
	helper: string;
}

type AttachmentKind = 'image' | 'audio' | 'document' | 'other';
type AttachmentSource = 'camera' | 'file' | 'voice' | 'sheet';

export interface AttachmentRef {
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

export interface UserWidget {
	id: string;
	title: string;
	unit: string;
	color: string;
	pinned: boolean;
	metricType: string;
	aggregation: string;
	period: string;
	range: string;
	sortOrder: number;
	createdAt: string;
	goal: number | null;
	thresholdWarn: number | null;
	thresholdSuccess: number | null;
	filterCategory: string | null;
	filterSubcategory: string | null;
}

export interface MediaHistoryItem {
	id: string;
	kind: 'image' | 'audio' | 'document' | 'other';
	name: string;
	url: string;
	mimeType?: string;
	note?: string;
	source?: 'camera' | 'file' | 'voice' | 'sheet';
	createdAt: string;
}

export interface HomeWidgetEntry {
	id: string;
	kind: 'checklist' | 'dynamic' | 'skeleton' | 'partner';
	checklist?: Checklist;
	widget?: UserWidget;
	skeletonIndex?: number;
}

export interface ActionItem {
	id: string;
	icon: string;
	label: string;
	value?: string | number;
	done: boolean;
	priority: number;
	onclick: () => void;
}

export interface EgenfrekvensSlotSummary {
	level: number | null;
	mode: 'quick' | 'full';
	balance: number | null;
}

export interface EgenfrekvensRecentPoint {
	day: string;
	morning: EgenfrekvensSlotSummary | null;
	evening: EgenfrekvensSlotSummary | null;
}

export interface SensorSummary {
	weight: { current: number | null; unit: string; delta: number; sparkline: number[] };
	sleep: { current: number | null; unit: string; sparkline: number[] };
	steps: { current: number | null; unit: string; sparkline: number[] };
	running: { weekKm: number; unit: string; sparkline: number[] };
	spending: { current: number; unit: string; delta: number; sparkline: number[] };
}

export interface TriageSuggestion {
	id: string;
	label: string;
	prompt: string;
}

type DisplayEntry =
	| { type: 'theme'; theme: Theme; key: string; collapsed: boolean }
	| { type: 'placeholder'; key: string };

// ── Kontekst-type ───────────────────────────────────────────────────────

export interface HomeContext {
	// ── Temaer ──
	themes: Theme[];
	relationshipOnboardingActive: boolean;
	relationshipTheme: Theme | null;

	// ── Drag & drop tema ──
	dragThemeId: string | null;
	dropIndex: number | null;
	isTouchDrag: boolean;
	themeListEl: HTMLElement | null;
	touchChip: { left: number; width: number; height: number; top: number } | null;
	draggedTheme: Theme | null;
	displayList: DisplayEntry[];

	// ── Tema-meny ──
	themeMenuId: string | null;
	themeMenuName: string;
	themeActionBusy: boolean;
	themePanelOpen: boolean;
	temaPressBlocked: boolean;

	// ── Widgets ──
	pinnedWidgets: UserWidget[];
	hiddenWidgets: UserWidget[];
	widgetsLoading: boolean;
	configWidget: UserWidget | null;
	widgetPanelOpen: boolean;
	homeWidgetPages: HomeWidgetEntry[][];
	widgetPagerEl: HTMLElement | null;
	currentWidgetPage: number;

	// ── Sjekklister ──
	activeChecklists: Checklist[];
	allContextChecklists: Checklist[];
	monthDayChecklists: Checklist[];
	monthMetrics: { effort: Record<string, number>; egenfrekvens: Record<string, number> } | null;
	openChecklist: Checklist | null;
	todaysRoutines: Array<{
		checklistId: string;
		title: string;
		emoji: string;
		slot: string;
		items: Array<{
			id: string;
			text: string;
			checked: boolean;
			sortOrder: number;
			estimateMinutes: number | null;
		}>;
	}>;
	monthDayData: Array<{
		planned: number;
		completed: number;
		effort: number | undefined;
		egenfrekvens: number | undefined;
		isPast: boolean;
		isToday: boolean;
	}>;

	// ── Chat-sone ──
	chatOpen: boolean;
	chatPrefill: string;
	chatInputAutoFocus: boolean;
	chatSection: HTMLElement | null;
	inputExpanded: boolean;
	homeChat: ChatState;
	selectedQuickAction: QuickActionId;
	activeQuickAction: QuickAction;
	hasPersistedConversation: boolean;
	chatConversationTitle: string;
	latestClosedConversationId: string | null;
	createdThemeLink: { id: string; name: string; emoji?: string | null } | null;
	launchingThemeId: string | null;
	returnToChatAfterFlow: boolean;
	selectedChatModel: string;
	suggestedTheme: { themeId: string; themeName: string; confidence: string; reasoning?: string } | null;
	routedToTheme: { themeId: string; themeName: string } | null;
	homeConversationList: RecentConversation[];
	homeEditingConversationId: string | null;
	homeEditingTitle: string;
	followUpConversations: RecentConversation[];
	followUpStarred: RecentConversation[];
	followUpRegular: RecentConversation[];

	// ── Handlinger ──
	actionsLoading: boolean;
	actionItems: ActionItem[];
	serverActionCandidates: ActionCandidate[];

	// ── Snooze-meny ──
	snoozeMenuChipId: string | null;
	snoozeMenuLabel: string;

	// ── Kamera ──
	cameraOpen: boolean;
	cameraFileInput: HTMLInputElement | null;
	cameraSelectedFile: File | null;
	cameraPreview: string | null;
	cameraCaption: string;
	cameraUploading: boolean;
	cameraError: boolean;
	cameraHistory: MediaHistoryItem[];
	cameraHistoryLoading: boolean;

	// ── Lyd ──
	voiceOpen: boolean;
	voiceText: string;
	voiceFileInput: HTMLInputElement | null;
	voiceSelectedFile: File | null;
	voiceUploading: boolean;
	voiceError: boolean;
	voiceHistory: MediaHistoryItem[];
	voiceHistoryLoading: boolean;

	// ── Fil ──
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

	// ── Egenfrekvens ──
	egenfrekvensFlowOpen: boolean;
	egenfrekvensQuickFlowOpen: boolean;
	egenfrekvensActiveSlot: 'morning' | 'evening';
	egenfrekvensPromptOpen: boolean;
	egenfrekvensPromptDay: string;
	egenfrekvensInitialNote: string;
	egenfrekvensReflectionPrompt: string | null;
	egenfrekvensDreamReasons: Record<string, Array<{ value: string; label: string; source: string }>> | null;
	egenfrekvensCarriedLevel: number | null;
	egenfrekvensRecent: {
		today: { morning: EgenfrekvensSlotSummary | null; evening: EgenfrekvensSlotSummary | null };
		points: EgenfrekvensRecentPoint[];
		settings: { enabled: boolean; morningTime: string; eveningTime: string } | null;
	} | null;

	// ── Planlegging ──
	homeDayPlanOpen: boolean;
	homeDayPlanIso: string;
	homeDayPlanWeekKey: string;
	homeWeekPlanOpen: boolean;
	homeWeekPlanContext: FlowContext;
	homeMonthPlanOpen: boolean;
	homeMonthPlanContext: FlowContext;

	// ── Treningsprogram readiness ──
	programReadiness: {
		programId: string;
		programName: string;
		state: 'klar' | 'lett' | 'easy' | 'rest';
		alternativeName: string | null;
	} | null;

	// ── Fokustimer / refleksjon / inbox / quick win ──
	focusTimerFlowOpen: boolean;
	reflectionLightFlowOpen: boolean;
	inboxNoteFlowOpen: boolean;
	quickWinFlowOpen: boolean;
	quickWinOpenItems: Array<{ id: string; text: string }>;

	// ── Dato/derivert ──
	dateLabel: string;

	// ── Funksjoner ──
	openChat: (prefill?: string, actionId?: QuickActionId, options?: { focusInput?: boolean }) => void;
	closeChat: () => void;
	startQuickAction: (action: QuickAction) => void;
	startHomeChat: (draftOverride?: string) => void;
	startHomeAttachment: (kind: 'camera' | 'voice' | 'file', draftOverride?: string, options?: { preserveConversation?: boolean }) => void;
	openPartnerOnboardingChat: () => void;
	openEgenfrekvensFlow: (initialNote?: string, preserveConversation?: boolean) => void;
	openEgenfrekvensQuick: (slot: 'morning' | 'evening') => void;
	openEgenfrekvensFull: (slot: 'morning' | 'evening') => void;
	sendChat: (text: string, imageUrl?: string, attachment?: AttachmentRef) => Promise<void>;
	stopChat: () => void;
	closeCameraFlow: () => void;
	closeVoiceFlow: () => void;
	closeFileFlow: () => void;
	handleCameraFileSelect: (event: Event) => void;
	handleVoiceFileSelect: (event: Event) => void;
	handleFileFlowSelect: (event: Event) => void;
	submitCamera: () => Promise<void>;
	submitVoice: () => Promise<void>;
	submitFile: () => void;
	submitSheetSnapshot: () => Promise<void>;
	handleWidgetPagerScroll: () => void;
	goToWidgetPage: (index: number) => void;
	handleChecklistPlan: (context: string | null) => Promise<void>;
	openWidgetConfigSheet: (widget: UserWidget) => void;
	navigateForWidget: (w: UserWidget) => void;
	unpinWidget: (id: string) => Promise<void>;
	repinWidget: (id: string) => Promise<void>;
	moveWidget: (id: string, direction: 'up' | 'down') => Promise<void>;
	deleteWidget: (id: string) => Promise<void>;
	saveWidgetConfig: (id: string, updates: Partial<UserWidget>) => Promise<void>;
	fetchChecklists: () => Promise<void>;
	loadActionCandidates: () => Promise<void>;
	loadEgenfrekvensRecent: () => Promise<void>;
	loadEgenfrekvensContext: () => Promise<void>;
	dispatchActionIntent: (intent: ActionIntent) => void;
	handleChipClick: (onclick: () => void) => void;
	startLongPress: (chipId: string, label: string, e: PointerEvent) => void;
	cancelLongPress: () => void;
	closeSnoozeMenu: () => void;
	snoozeChip: (scope: 'today' | 'week' | 'forever') => Promise<void>;
	handleTemaPressStart: (e: PointerEvent) => void;
	handleTemaPressEnd: () => void;
	handleThemeDragStart: (id: string) => void;
	handleThemeDragOver: (e: DragEvent) => void;
	commitThemeReorder: () => void;
	handleTouchDragStart: (e: TouchEvent, id: string) => void;
	handleTouchDragMove: (e: TouchEvent) => void;
	handleTouchDragEnd: () => void;
	resetDrag: () => void;
	startThemeRowPress: (theme: { id: string; name: string }) => void;
	cancelThemeRowPress: () => void;
	closeThemeMenu: () => void;
	handleThemeRowClick: (theme: { id: string }) => void;
	archiveThemeFromMenu: (id: string) => Promise<void>;
	deleteThemeFromMenu: (id: string, name: string) => Promise<void>;
	openCreatedTheme: (themeId: string) => Promise<void>;
	formatFollowUpDate: (iso: string) => string;
	setHomeConversationStarred: (id: string, starred: boolean) => void;
	setHomeConversationArchived: (id: string, archived: boolean) => void;
	removeHomeConversation: (id: string) => void;
	moveHomeConversationTheme: (id: string, themeId: string | null) => void;
	startHomeConversationRename: (id: string, currentTitle: string) => void;
	cancelHomeConversationRename: () => void;
	commitHomeConversationRename: (id: string) => Promise<void>;
	reuseCameraMedia: (item: MediaHistoryItem) => Promise<void>;
	reuseVoiceMedia: (item: MediaHistoryItem) => Promise<void>;
	reuseFileMedia: (item: MediaHistoryItem) => Promise<void>;
	refreshHomeData: () => Promise<void>;
	openWeekPlan: (weekKey: string) => Promise<void>;
	openMonthPlan: (monthKey: string) => Promise<void>;
	openQuickWin: () => Promise<void>;
	pendingActionHandlers: Record<string, () => void>;

	// Ekstra hjelpefunksjoner
	getLocalIsoWeekDashed: (now?: Date) => string;
	toLocalIsoDate: (date: Date) => string;
}
