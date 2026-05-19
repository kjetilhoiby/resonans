<!--
  HomeScreen — fire-sone hjemskjerm.

  Layout: 10 / 28 / 24 / 28  (tittel / widgets / tema / input)
  Ingen tab-bar, ingen overlays. Soner animerer til fullskjerm ved tap.

  Props:
    themes    aktive temaer fra DB (for tema-grid)
-->
<script lang="ts">
	import { goto, preloadCode, preloadData } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import EgenfrekvensQuickCard from '../composed/EgenfrekvensQuickCard.svelte';
	import WidgetConfigSheet from '../ui/WidgetConfigSheet.svelte';
	import MorphTitle from '../ui/MorphTitle.svelte';
	import Icon from '../ui/Icon.svelte';
	import ChatInput from '../ui/ChatInput.svelte';
	import ChatMessages from '../ui/ChatMessages.svelte';
	import ChecklistWidget, { type Checklist } from '../composed/ChecklistWidget.svelte';
	import ChecklistSheet from '../ui/ChecklistSheet.svelte';
	import FlowSheet from '../flows/FlowSheet.svelte';
	import EgenfrekvensPrompt from './EgenfrekvensPrompt.svelte';
	import PullToRefresh from '../ui/PullToRefresh.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import PageHeader from '../ui/PageHeader.svelte';
	import CollapsibleSection from '../ui/CollapsibleSection.svelte';
	import ConversationContextMenu from '../ui/ConversationContextMenu.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { prefetchDashboard } from '$lib/client/dashboard-cache';
	import { prefetchWidgetData } from '$lib/client/widget-data-cache';
	import { finishNavMetric, startNavMetric, timeAsync } from '$lib/client/nav-metrics';
	import { ChatState } from '$lib/client/chat-state.svelte';

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		themes: Theme[];
		recentConversations: {
			id: string;
			title: string;
			preview: string;
			starred: boolean;
			archived: boolean;
			linkedTheme: { id: string; name: string; emoji: string | null } | null;
			updatedAt: string;
		}[];
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

	let { themes: initialThemes, recentConversations }: Props = $props();

	let themes = $state(initialThemes);
	$effect(() => { themes = initialThemes; });

	let dragThemeId = $state<string | null>(null);
	let dragOverThemeId = $state<string | null>(null);

	function handleThemeDragStart(id: string) {
		dragThemeId = id;
	}

	function handleThemeDragOver(e: DragEvent, id: string) {
		e.preventDefault();
		dragOverThemeId = id;
	}

	function handleThemeDrop(targetId: string) {
		if (!dragThemeId || dragThemeId === targetId) { dragThemeId = null; dragOverThemeId = null; return; }
		const from = themes.findIndex((t) => t.id === dragThemeId);
		const to = themes.findIndex((t) => t.id === targetId);
		if (from === -1 || to === -1) return;
		const reordered = [...themes];
		const [moved] = reordered.splice(from, 1);
		reordered.splice(to, 0, moved);
		themes = reordered;
		dragThemeId = null;
		dragOverThemeId = null;
		void fetch('/api/tema/reorder', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(reordered.map((t, i) => ({ id: t.id, sortOrder: i })))
		});
	}

	function normalizeThemeName(value: string) {
		return value
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');
	}

	function isRelationshipThemeName(name: string) {
		const normalized = normalizeThemeName(name);
		return /(parforhold|partner|samliv|relasjon|forhold)/.test(normalized);
	}

	const relationshipOnboardingActive = $derived($page.url.searchParams.get('onboarding') === 'partner');
	const relationshipTheme = $derived(themes.find((theme) => isRelationshipThemeName(theme.name)) ?? null);

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
	let pinnedWidgets = $state<UserWidget[]>([]);
	let hiddenWidgets = $state<UserWidget[]>([]);
	let widgetsLoading = $state(true);
	let configWidget = $state<UserWidget | null>(null);
	let widgetPanelOpen = $state(false);
	let themePanelOpen = $state(false);
	let temaPressTimer: ReturnType<typeof setTimeout> | null = null;
	let temaPressBlocked = false;

	function handleTemaPressStart(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		temaPressTimer = setTimeout(() => {
			temaPressBlocked = true;
			themePanelOpen = true;
		}, 500);
	}

	function handleTemaPressEnd() {
		if (temaPressTimer) { clearTimeout(temaPressTimer); temaPressTimer = null; }
		if (temaPressBlocked) { setTimeout(() => { temaPressBlocked = false; }, 50); }
	}

	// -- Sjekklister --
	let activeChecklists = $state<Checklist[]>([]);
	let monthDayChecklists = $state<Checklist[]>([]);
	let openChecklist = $state<Checklist | null>(null);

	// -- Pull to refresh (mobil) --
	async function refreshHomeData() {
		await Promise.allSettled([
			fetchChecklists(),
			fetchSensorAndWidgets({ useCache: false })
		]);
	}

	// -- Planleggingsflyt fra tom sjekkliste --
	let homeDayPlanOpen = $state(false);
	let homeDayPlanIso = $state('');
	let homeDayPlanWeekKey = $state('');
	let homeWeekPlanOpen = $state(false);
	let homeMonthPlanOpen = $state(false);
	let homeMonthPlanContext = $state<import('$lib/flows/types').FlowContext>({});

	async function handleChecklistPlan(context: string | null) {
		if (!context) return;
		const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) {
			homeDayPlanWeekKey = dayMatch[1];
			homeDayPlanIso = dayMatch[2];
			homeDayPlanOpen = true;
			return;
		}
		if (/^week:\d{4}-W\d{2}$/.test(context)) {
			homeWeekPlanOpen = true;
			return;
		}
		if (/^month:/.test(context)) {
			const monthKey = context.replace('month:', '');
			try {
				const res = await fetch(`/api/month-plan/context?month=${encodeURIComponent(monthKey)}`);
				if (!res.ok) { void goto('/maanedsplan'); return; }
				const ctx = await res.json() as {
					currentMonthKey: string;
					currentMonthName: string;
					prevMonthKey: string;
					prevMonthName: string;
					note: string;
					reflection: string;
					uncheckedItems: Array<{ id: string; text: string }>;
					monthGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
					recurringTasks: string[];
				};
				const goalLines = ctx.monthGoals.map((g) => {
					const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
					return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pct !== null ? ` (${pct}%)` : ''}`;
				}).join('\n');
				homeMonthPlanContext = {
					monthKey: ctx.currentMonthKey,
					openItems: ctx.uncheckedItems,
					weekTasks: ctx.recurringTasks,
					prevMonthData: {
						monthName: ctx.prevMonthName,
						note: ctx.note,
						reflection: ctx.reflection,
						uncheckedItems: ctx.uncheckedItems,
						monthGoals: ctx.monthGoals,
						recurringTasks: ctx.recurringTasks
					},
					systemPrompts: {
						refleksjon: [
							`Det er nå ${ctx.currentMonthName} og brukeren er klar for månedsplanlegging.`,
							ctx.prevMonthName ? `\nForrige måned (${ctx.prevMonthName}):` : '',
							ctx.note ? `Månedsnotat: "${ctx.note}"` : '',
							ctx.reflection ? `Refleksjon: "${ctx.reflection}"` : '',
							goalLines ? `\nMål:\n${goalLines}` : '',
							'\nGi en kort, varm oppsummering av forrige måned (2-3 setninger). Avslutt med ett åpent spørsmål om hva som gikk bra og hva som var utfordrende.'
						].filter(Boolean).join('\n'),
						maal: [
							`Du hjelper brukeren å sette månedsmål for ${ctx.currentMonthName}.`,
							goalLines ? `\nForrige måneds mål og fremgang (${ctx.prevMonthName}):\n${goalLines}` : '\nIngen mål fra forrige måned.',
							'\nSkille mellom mål og oppgaver:',
							'- MÅNEDSMÅL: kun for ting med målbar fremdrift mot et tall (løping i km, vekt i kg, frekvente treningsøkter per uke). Hold listen kort.',
							'- MÅNEDSOPPGAVER: ting du gjør 1–8 ganger denne måneden (utenatt, utebad, sykling til jobb, planleggingsprat hjemme osv.)',
							'\nGå gjennom forrige måneds mål. Foreslå om hvert bør videreføres eller justeres. Kom gjerne med nye oppgaver basert på refleksjonen.',
							'\nAvslutt alltid med begge listene (utelat seksjoner som ikke passer):',
							'\nMÅNEDSMÅL:',
							'- [tittel]: [verdi] [enhet]',
							'\nMÅNEDSOPPGAVER:',
							'- [tittel]: [antall] [enhet]'
						].filter(Boolean).join('\n'),
						maanedshistorie: [
							`Du hjelper brukeren å skrive en kort månedsbeskrivelse for ${ctx.currentMonthName}.`,
							`Spør: "Hva handler ${ctx.currentMonthName} om for deg?"`,
							'Basert på svaret, skriv et utkast på 1-2 avsnitt. Vær personlig og konkret.',
							'La brukeren justere utkastet via chat. Avslutt med det endelige notatet.'
						].join('\n')
					}
				};
				homeMonthPlanOpen = true;
			} catch {
				void goto('/maanedsplan');
			}
		}
	}

	// -- Hjemstedsvær fjernet (vises nå bare i ChecklistSheet og ukeplan-dagsvelger) --

	function getDateFromChecklistContext(context: string | null): string | null {
		if (!context) return null;
		const m = context.match(/^week:\d{4}-W\d{2}:day:(\d{4}-\d{2}-\d{2})$/);
		return m?.[1] ?? null;
	}

	const HOME_SENSOR_CACHE_KEY = 'resonans:home:sensor-summary:v1';
	const HOME_PINNED_WIDGETS_CACHE_KEY = 'resonans:home:pinned-widgets:v1';
	const HOME_SENSOR_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
	const HOME_PINNED_WIDGETS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

	interface CachedPayload<T> {
		cachedAt: string;
		data: T;
	}

	function readCachedPayload<T>(key: string, maxAgeMs: number): T | null {
		if (typeof window === 'undefined') return null;

		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return null;

			const parsed = JSON.parse(raw) as CachedPayload<T>;
			if (!parsed?.cachedAt) return null;

			const ageMs = Date.now() - new Date(parsed.cachedAt).getTime();
			if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) return null;

			return parsed.data ?? null;
		} catch {
			return null;
		}
	}

	function writeCachedPayload<T>(key: string, data: T) {
		if (typeof window === 'undefined') return;

		try {
			const payload: CachedPayload<T> = {
				cachedAt: new Date().toISOString(),
				data
			};
			window.localStorage.setItem(key, JSON.stringify(payload));
		} catch {
			// Ignorer lagringsfeil (f.eks. quota eller private mode)
		}
	}

	function toLocalIsoDate(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function toLocalYearMonth(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		return `${year}-${month}`;
	}

	function getLocalIsoWeekDashed(now: Date = new Date()) {
		const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
		const dayNum = d.getUTCDay() || 7;
		d.setUTCDate(d.getUTCDate() + 4 - dayNum);
		const year = d.getUTCFullYear();
		const yearStart = new Date(Date.UTC(year, 0, 1));
		const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
		const week = String(weekNo).padStart(2, '0');
		return `${year}-W${week}`;
	}

	function sortActiveChecklists(rows: Checklist[]) {
		const currentMonthContext = `month:${toLocalYearMonth(new Date())}`;
		const currentWeekContext = `week:${getLocalIsoWeekDashed()}`;
		const currentDayContext = `week:${getLocalIsoWeekDashed()}:day:${toLocalIsoDate(new Date())}`;
		const priority = new Map<string, number>([
			[currentMonthContext, 0],
			[currentWeekContext, 1],
			[currentDayContext, 2]
		]);

		return [...rows]
			.filter((checklist) => {
				const context = checklist.context ?? '';
				return priority.has(context);
			})
			.sort((a, b) => {
				const aPriority = priority.get(a.context ?? '') ?? 99;
				const bPriority = priority.get(b.context ?? '') ?? 99;
				if (aPriority !== bPriority) return aPriority - bPriority;
				return a.title.localeCompare(b.title, 'nb-NO');
			});
	}

	function getMonthDayContexts(year: number, month: number): string[] {
		const daysInMonth = new Date(year, month, 0).getDate();
		const contexts: string[] = [];
		for (let day = 1; day <= daysInMonth; day++) {
			const date = new Date(year, month - 1, day);
			const weekKey = getLocalIsoWeekDashed(date);
			const isoDate = toLocalIsoDate(date);
			contexts.push(`week:${weekKey}:day:${isoDate}`);
		}
		return contexts;
	}

	async function fetchChecklists() {
		try {
			const now = new Date();
			const [year, monthStr] = toLocalYearMonth(now).split('-');
			const monthNum = Number(monthStr);
			const dayContexts = getMonthDayContexts(Number(year), monthNum);
			const monthContext = `month:${toLocalYearMonth(now)}`;
			const weekContext = `week:${getLocalIsoWeekDashed(now)}`;

			const activePromise = fetch('/api/checklists?active=true').then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as Checklist[];
			});

			const allContexts = [monthContext, weekContext, ...dayContexts].join(',');
			const monthDayPromise = fetch(
				`/api/checklists?contexts=${encodeURIComponent(allContexts)}`
			).then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as Checklist[];
			});

			const [activeRows, contextRows] = await Promise.all([activePromise, monthDayPromise]);
			if (activeRows) {
				activeChecklists = sortActiveChecklists(activeRows);
			}
			if (contextRows) {
				monthDayChecklists = contextRows.filter((c) =>
					(c.context ?? '').startsWith(`week:`) && (c.context ?? '').includes(':day:')
				);
			}
		} catch { /* stille */ }
	}

	function scheduleWidgetDataPrefetch(widgets: UserWidget[]) {
		if (widgets.length === 0 || typeof window === 'undefined') return;
		const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
		if (connection?.saveData) return;
		if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return;

		const ids = widgets.slice(0, 3).map((w) => w.id);
		const run = () => {
			for (const id of ids) void prefetchWidgetData(id);
		};
		if ('requestIdleCallback' in window) {
			window.requestIdleCallback(run, { timeout: 1200 });
		} else {
			setTimeout(run, 100);
		}
	}

	async function fetchSensorAndWidgets({ useCache }: { useCache: boolean }) {
		if (useCache) {
			const cachedSummary = readCachedPayload<SensorSummary>(HOME_SENSOR_CACHE_KEY, HOME_SENSOR_CACHE_MAX_AGE_MS);
			if (cachedSummary) {
				sensorSummary = cachedSummary;
				widgetsLoading = false;
			}

			const cachedPinnedWidgets = readCachedPayload<UserWidget[]>(
				HOME_PINNED_WIDGETS_CACHE_KEY,
				HOME_PINNED_WIDGETS_CACHE_MAX_AGE_MS
			);
			if (cachedPinnedWidgets && cachedPinnedWidgets.length > 0) {
				pinnedWidgets = cachedPinnedWidgets;
				// Start widget-data-henting umiddelbart for cachede IDs, så DynamicWidget
				// finner in-memory treff allerede før/under sin egen onMount-fetch.
				scheduleWidgetDataPrefetch(cachedPinnedWidgets);
				widgetsLoading = false;
			}
		}

		try {
			const [summaryRes, widgetsRes] = await timeAsync('sensor+widgets parallel', () =>
				Promise.all([
					fetch('/api/sensor-summary'),
					fetch('/api/user-widgets')
				])
			);
			if (summaryRes.ok) {
				sensorSummary = await summaryRes.json();
				writeCachedPayload(HOME_SENSOR_CACHE_KEY, sensorSummary);
			}
			if (widgetsRes.ok) {
				const allWidgets = await widgetsRes.json();
				pinnedWidgets = allWidgets.filter((w: UserWidget) => w.pinned);
				hiddenWidgets = allWidgets.filter((w: UserWidget) => !w.pinned);
				writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
			}
		} catch {
			// Stille feil — fallback til cache/mock-data
		} finally {
			widgetsLoading = false;
		}
	}

	onMount(() => {
		void (async () => {
			finishNavMetric('home');

			// Start checklists concurrently — ingen datavhengighet til sensor/widget
			const checklistPromise = timeAsync('checklists', () => fetchChecklists());
			await fetchSensorAndWidgets({ useCache: true });
			await checklistPromise;

			// Warm up theme route code and server data so first navigation feels snappier.
			if (typeof window !== 'undefined') {
				const runPreload = () => {
					void preloadCode('/tema/*');
					// Prefetch server load-data for topp-temaer mens brukeren er idle
					for (const theme of themes.slice(0, 2)) {
						void preloadData(`/tema/${theme.id}`);
					}
				};

				if ('requestIdleCallback' in window) {
					window.requestIdleCallback(runPreload, { timeout: 1200 });
				} else {
					setTimeout(runPreload, 180);
				}
			}

			if ($page.url.searchParams.get('chat') === '1') {
				openChat();
			}

			void loadEgenfrekvensRecent();

			// URL-trigget egenfrekvens-flow (fra push-nudge eller dyp-lenke)
			const flowParam = $page.url.searchParams.get('flow');
			if (flowParam === 'egenfrekvens_checkin' || flowParam === 'egenfrekvens_quick') {
				egenfrekvensActiveSlot = currentSlotFromUrl();
				if (flowParam === 'egenfrekvens_checkin') {
					egenfrekvensFlowOpen = true;
					void loadEgenfrekvensContext();
				} else {
					egenfrekvensQuickFlowOpen = true;
				}
				const nudgeId = $page.url.searchParams.get('nudgeEventId');
				if (nudgeId) {
					void fetch(`/api/nudges/events/${nudgeId}/stage`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ stage: 'flow_started' })
					}).catch(() => {});
				}
			}

			// App-open prompt: vis banner hvis dagens sjekkin venter, settings tillater og ikke avvist i dag
			void (async () => {
				try {
					const isoDay = new Date().toISOString().slice(0, 10);
					const res = await fetch(`/api/egenfrekvens/status?day=${isoDay}`);
					if (!res.ok) return;
					const status = await res.json();
					if (!status.settings || status.settings.enabled === false) return;
					if (typeof localStorage !== 'undefined') {
						const dismissed = localStorage.getItem(`egenfrekvens-prompt-dismissed-${status.day}`);
						if (dismissed) return;
					}
					const morning = status.settings.morningTime ?? '06:30';
					const evening = status.settings.eveningTime ?? '21:00';
					const count = typeof status.count === 'number' ? status.count : status.submitted ? 1 : 0;
					const nowHm = new Intl.DateTimeFormat('en-GB', {
						hour: '2-digit',
						minute: '2-digit',
						hour12: false
					}).format(new Date());
					const showMorning = nowHm >= morning && count === 0;
					const showEvening = nowHm >= evening && count < 2;
					if (!showMorning && !showEvening) return;
					egenfrekvensPromptDay = status.day;
					egenfrekvensPromptOpen = true;
				} catch {
					// best-effort UI hint, ignore failures
				}
			})();
		})();
	});

	interface EgenfrekvensSlotSummary {
		level: number | null;
		mode: 'quick' | 'full';
		balance: number | null;
	}

	interface EgenfrekvensRecentPoint {
		day: string;
		morning: EgenfrekvensSlotSummary | null;
		evening: EgenfrekvensSlotSummary | null;
	}

	interface HomeWidgetEntry {
		id: string;
		kind: 'checklist' | 'dynamic' | 'skeleton' | 'partner';
		checklist?: Checklist;
		widget?: UserWidget;
		skeletonIndex?: number;
	}

	let egenfrekvensRecent = $state<{
		today: { morning: EgenfrekvensSlotSummary | null; evening: EgenfrekvensSlotSummary | null };
		points: EgenfrekvensRecentPoint[];
		settings: { enabled: boolean; morningTime: string; eveningTime: string } | null;
	} | null>(null);

	// ── Handlingssone (foreslåtte handlinger) ───────────────────────────────
	// Prioritert karusell. Foreløpig kun "sjekk inn", men strukturen er klar
	// for flere kort skåret etter tid på døgnet/uka og bruksmønster.
	interface ActionItem {
		id: string;
		icon: string;
		label: string;
		value?: string | number;
		done: boolean;
		priority: number;
		onclick: () => void;
	}

	const actionItems = $derived.by<ActionItem[]>(() => {
		const items: ActionItem[] = [];

		if (egenfrekvensRecent && egenfrekvensRecent.settings?.enabled !== false) {
			const slot = currentSlotFromTime();
			const entry =
				slot === 'morning' ? egenfrekvensRecent.today.morning : egenfrekvensRecent.today.evening;
			items.push({
				id: 'egenfrekvens-quick',
				icon: '✨',
				label: `Sjekk inn · ${slot === 'morning' ? 'morgen' : 'kveld'}`,
				value: entry?.level ?? undefined,
				done: entry !== null,
				priority: entry === null ? 100 : 60,
				onclick: () => openEgenfrekvensQuick(slot)
			});
		}

		return items.sort((a, b) => b.priority - a.priority);
	});

	async function loadEgenfrekvensRecent() {
		try {
			const res = await fetch('/api/egenfrekvens/recent?days=7');
			if (!res.ok) return;
			egenfrekvensRecent = await res.json();
		} catch {
			// best-effort, ignore
		}
	}

	function openEgenfrekvensQuick(slot: 'morning' | 'evening') {
		egenfrekvensActiveSlot = slot;
		egenfrekvensQuickFlowOpen = true;
	}

	function openEgenfrekvensFull(slot: 'morning' | 'evening') {
		egenfrekvensActiveSlot = slot;
		egenfrekvensFlowOpen = true;
		void loadEgenfrekvensContext();
	}

	const metricWidgetEntries = $derived.by<HomeWidgetEntry[]>(() => {
		if (widgetsLoading) {
			return Array.from({ length: 3 }, (_, i) => ({
				id: `skeleton:${i}`,
				kind: 'skeleton',
				skeletonIndex: i
			}));
		}

		if (pinnedWidgets.length > 0) {
			return pinnedWidgets.map((widget) => ({
				id: `dynamic:${widget.id}`,
				kind: 'dynamic' as const,
				widget
			}));
		}

		if (relationshipOnboardingActive) {
			return [{ id: 'partner-onboarding', kind: 'partner' }];
		}

		return [];
	});

	const monthDayData = $derived.by(() => {
		const now = new Date();
		const year = now.getFullYear();
		const month = now.getMonth() + 1;
		const daysInMonth = new Date(year, month, 0).getDate();
		const todayDay = now.getDate();
		const byDate = new Map<string, Checklist>();
		for (const c of monthDayChecklists) {
			const m = (c.context ?? '').match(/:day:(\d{4}-\d{2}-\d{2})$/);
			if (m) byDate.set(m[1], c);
		}
		return Array.from({ length: daysInMonth }, (_, i) => {
			const dayNum = i + 1;
			const isPast = dayNum < todayDay;
			const isToday = dayNum === todayDay;
			const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
			const cl = byDate.get(iso);
			if (!cl || !(isPast || isToday)) {
				return { planned: 0, completed: 0, isPast, isToday };
			}
			// Tell ikke 'gjør ikke'-oppgaver og hopp over gruppe-headere.
			const items = cl.items.filter((it) => {
				if (it.skippedAt) return false;
				if (it.parentId) return true;
				return !cl.items.some((c2) => c2.parentId === it.id);
			});
			const planned = items.length;
			const completed = items.filter((it) => it.checked).length;
			return { planned, completed, isPast, isToday };
		});
	});

	const homeWidgetEntries = $derived.by<HomeWidgetEntry[]>(() => {
		const now = new Date();
		const monthCtx = `month:${toLocalYearMonth(now)}`;
		const weekCtx = `week:${getLocalIsoWeekDashed(now)}`;
		const dayCtx = `week:${getLocalIsoWeekDashed(now)}:day:${toLocalIsoDate(now)}`;

		// Fast rekkefølge: måned → uke → dag
		const orderedChecklists: HomeWidgetEntry[] = [monthCtx, weekCtx, dayCtx].map((ctx) => {
			const existing = activeChecklists.find((c) => c.context === ctx);
			const checklist = existing ?? {
				id: `synthetic:${ctx}`,
				title: '',
				emoji: '📅',
				context: ctx,
				completedAt: null,
				items: []
			};
			return {
				id: existing ? `checklist:${existing.id}` : `synthetic:${ctx}`,
				kind: 'checklist' as const,
				checklist
			};
		});

		return [...orderedChecklists, ...metricWidgetEntries];
	});

	function chunkWidgets<T>(rows: T[], size: number): T[][] {
		if (rows.length === 0) return [[]];
		const chunks: T[][] = [];
		for (let i = 0; i < rows.length; i += size) {
			chunks.push(rows.slice(i, i + size));
		}
		return chunks;
	}

	const WIDGETS_PER_PAGE = 6;
	const homeWidgetPages = $derived(chunkWidgets(homeWidgetEntries, WIDGETS_PER_PAGE));
	let widgetPagerEl = $state<HTMLElement | null>(null);
	let currentWidgetPage = $state(0);

	$effect(() => {
		const total = homeWidgetPages.length;
		if (total === 0) {
			currentWidgetPage = 0;
			return;
		}
		if (currentWidgetPage > total - 1) {
			currentWidgetPage = total - 1;
		}
	});

	function handleWidgetPagerScroll() {
		if (!widgetPagerEl) return;
		const width = widgetPagerEl.clientWidth;
		if (width <= 0) return;
		currentWidgetPage = Math.round(widgetPagerEl.scrollLeft / width);
	}

	function goToWidgetPage(index: number) {
		if (!widgetPagerEl) return;
		const clamped = Math.max(0, Math.min(index, homeWidgetPages.length - 1));
		widgetPagerEl.scrollTo({
			left: clamped * widgetPagerEl.clientWidth,
			behavior: 'smooth'
		});
		currentWidgetPage = clamped;
	}

	// -- Chat-sone --
	let chatOpen = $state(false);
	let chatPrefill = $state('');
	let latestClosedConversationId = $state<string | null>(null);
	let createdThemeLink = $state<{ id: string; name: string; emoji?: string | null } | null>(null);
	let launchingThemeId = $state<string | null>(null);
	let chatInputAutoFocus = $state(false);
	let returnToChatAfterFlow = $state(false);
	let selectedChatModel = $state<string>(
		(typeof localStorage !== 'undefined' && localStorage.getItem('chat-model')) || 'auto'
	);
	
	// Tema-routing state
	let suggestedTheme = $state<{ themeId: string; themeName: string; confidence: string; reasoning?: string } | null>(null);
	let routedToTheme = $state<{ themeId: string; themeName: string } | null>(null);

	const homeChat = new ChatState({
		getOrCreateConversationId: async () => {
			const res = await fetch('/api/conversations/new', { method: 'POST' });
			if (!res.ok) return null;
			const json = await res.json();
			return json.conversationId ?? null;
		},
		preferredModel: () => selectedChatModel !== 'auto' ? selectedChatModel : undefined,
		onPayload: (data) => {
			const theme = data.themeCreated && data.theme && typeof data.theme === 'object' ? data.theme as { id?: string; name?: string; emoji?: string | null } : null;
			if (theme?.id) {
				createdThemeLink = { id: theme.id, name: theme.name ?? '', emoji: theme.emoji ?? null };
			}
		},
		onThemeRouted: (theme) => {
			routedToTheme = theme;
		},
		onThemeSuggested: (theme) => {
			suggestedTheme = theme;
		},
		onBookRouted: (book) => {
			closeChat();
			goto(`/tema/${book.themeId}?tab=books&bookId=${book.bookId}`);
		},
		onChecklistChanged: fetchChecklists,
	});

	// ── Media history types ───────────────────────────────────────────────────
	interface MediaHistoryItem {
		id: string;
		kind: 'image' | 'audio' | 'document' | 'other';
		name: string;
		url: string;
		mimeType?: string;
		note?: string;
		source?: 'camera' | 'file' | 'voice' | 'sheet';
		createdAt: string;
	}

	// ── Kamera-flyt ────────────────────────────────────────────────────────────
	let cameraOpen = $state(false);
	let cameraFileInput = $state<HTMLInputElement | null>(null);
	let cameraSelectedFile = $state<File | null>(null);
	let cameraPreview = $state<string | null>(null);
	let cameraCaption = $state('');
	let cameraUploading = $state(false);
	let cameraError = $state(false);
	let cameraHistory = $state<MediaHistoryItem[]>([]);
	let cameraHistoryLoading = $state(false);

	// ── Lyd-flyt ───────────────────────────────────────────────────────────────
	let voiceOpen = $state(false);
	let voiceText = $state('');
	let voiceFileInput = $state<HTMLInputElement | null>(null);
	let voiceSelectedFile = $state<File | null>(null);
	let voiceUploading = $state(false);
	let voiceError = $state(false);
	let voiceHistory = $state<MediaHistoryItem[]>([]);
	let voiceHistoryLoading = $state(false);

	// ── Egenfrekvens-sjekkin ──────────────────────────────────────────────────
	let egenfrekvensFlowOpen = $state(false);
	let egenfrekvensQuickFlowOpen = $state(false);
	let egenfrekvensActiveSlot = $state<'morning' | 'evening'>('morning');
	let egenfrekvensPromptOpen = $state(false);
	let egenfrekvensPromptDay = $state('');
	let egenfrekvensInitialNote = $state('');
	let egenfrekvensReflectionPrompt = $state<string | null>(null);
	let egenfrekvensDreamReasons = $state<Record<string, Array<{ value: string; label: string; source: string }>> | null>(null);

	function currentSlotFromTime(): 'morning' | 'evening' {
		return new Date().getHours() < 14 ? 'morning' : 'evening';
	}

	function currentSlotFromUrl(): 'morning' | 'evening' {
		const fromUrl = $page.url.searchParams.get('slot');
		if (fromUrl === 'morning' || fromUrl === 'evening') return fromUrl;
		return currentSlotFromTime();
	}

	async function loadEgenfrekvensContext() {
		const isoDay = new Date().toISOString().slice(0, 10);
		await Promise.all([
			fetch(`/api/egenfrekvens/reflection-context?day=${isoDay}`)
				.then((r) => r.ok ? r.json() : null)
				.then((ctx) => {
					egenfrekvensReflectionPrompt = typeof ctx?.systemPrompt === 'string' ? ctx.systemPrompt : null;
				})
				.catch(() => { egenfrekvensReflectionPrompt = null; }),
			fetch('/api/egenfrekvens/dream-reasons')
				.then((r) => r.ok ? r.json() : null)
				.then((reasons) => { egenfrekvensDreamReasons = reasons; })
				.catch(() => { egenfrekvensDreamReasons = null; })
		]);
	}

	function openEgenfrekvensFlow(initialNote = '', preserveConversation = false) {
		egenfrekvensInitialNote = initialNote.trim();
		returnToChatAfterFlow = preserveConversation;
		if (!preserveConversation) {
			chatOpen = false;
		}
		chatInputAutoFocus = false;
		egenfrekvensFlowOpen = true;
		void loadEgenfrekvensContext();
	}

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
	let fileHistory = $state<MediaHistoryItem[]>([]);
	let fileHistoryLoading = $state(false);

	const QUICK_ACTIONS: QuickAction[] = [
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
	let selectedQuickAction = $state<QuickActionId>('chat');
	const activeQuickAction = $derived(
		QUICK_ACTIONS.find((action) => action.id === selectedQuickAction) ?? QUICK_ACTIONS[0]
	);
	const hasPersistedConversation = $derived(Boolean(homeChat.conversationId));
	const chatConversationTitle = $derived.by(() => {
		if (!hasPersistedConversation) return '';
		const firstUserMessage = homeChat.messages.find((msg) => msg.role === 'user' && msg.text && msg.text !== '📷 [Bilde]');
		const base = firstUserMessage?.text?.trim() || 'Ny samtale';
		return base.length > 42 ? `${base.slice(0, 42).trimEnd()}…` : base;
	});

	let homeConversationList = $state(recentConversations);
	let homeEditingConversationId = $state<string | null>(null);
	let homeEditingTitle = $state('');

	$effect(() => {
		homeConversationList = recentConversations;
	});

	const followUpConversations = $derived.by(() => {
		const activeId = homeChat.conversationId || latestClosedConversationId;
		return homeConversationList
			.filter((c) => c.id !== activeId)
			.slice(0, 6);
	});

	const followUpStarred = $derived(followUpConversations.filter((c) => c.starred && !c.archived));
	const followUpRegular = $derived(followUpConversations.filter((c) => !c.starred && !c.archived));

	function setHomeConversationStarred(id: string, starred: boolean) {
		homeConversationList = homeConversationList.map((c) => (c.id === id ? { ...c, starred } : c));
	}

	function setHomeConversationArchived(id: string, archived: boolean) {
		homeConversationList = homeConversationList.map((c) => (c.id === id ? { ...c, archived } : c));
	}

	function removeHomeConversation(id: string) {
		homeConversationList = homeConversationList.filter((c) => c.id !== id);
	}

	function moveHomeConversationTheme(id: string, themeId: string | null) {
		const nextTheme = themeId ? themes.find((t) => t.id === themeId) ?? null : null;
		homeConversationList = homeConversationList.map((c) =>
			c.id === id
				? {
						...c,
						linkedTheme: nextTheme
							? { id: nextTheme.id, name: nextTheme.name, emoji: nextTheme.emoji ?? null }
							: null
					}
				: c
		);
	}

	function startHomeConversationRename(id: string, currentTitle: string) {
		homeEditingConversationId = id;
		homeEditingTitle = currentTitle;
	}

	function cancelHomeConversationRename() {
		homeEditingConversationId = null;
		homeEditingTitle = '';
	}

	async function commitHomeConversationRename(id: string) {
		const title = homeEditingTitle.trim();
		if (!title) {
			cancelHomeConversationRename();
			return;
		}

		homeConversationList = homeConversationList.map((c) => (c.id === id ? { ...c, title } : c));
		homeEditingConversationId = null;

		await fetch(`/api/conversations/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title })
		});
	}

	const inputExpanded = $derived(chatOpen || cameraOpen || voiceOpen || fileFlowOpen);
	let chatSection: HTMLElement | null = $state(null);

	function formatFollowUpDate(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function shouldAutoFocusInput() {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(pointer: fine)').matches;
	}

	function openChat(
		prefill = '',
		actionId: QuickActionId = selectedQuickAction,
		options?: { focusInput?: boolean }
	) {
		selectedQuickAction = actionId;
		chatPrefill = prefill;
		chatInputAutoFocus = options?.focusInput ?? shouldAutoFocusInput();
		chatOpen = true;
	}

	function startQuickAction(action: QuickAction) {
		homeChat.reset();
		homeChat.conversationId = null;
		chatPrefill = '';
		createdThemeLink = null;
		if (action.id === 'chat') {
			openChat('', 'chat');
		} else if (action.id === 'camera') {
			cameraOpen = true;
		} else if (action.id === 'voice') {
			voiceOpen = true;
		} else if (action.id === 'mood') {
			egenfrekvensFlowOpen = true;
		} else if (action.id === 'file') {
			fileFlowOpen = true;
		}
	}

	function openPartnerOnboardingChat() {
		openChat(
			'Vi har nettopp koblet oss som partnere i Resonans. Hjelp oss å sette opp et parforhold-tema, foreslå 3 fokusområder, og lag første ukes mini-plan med konkrete steg.',
			'chat'
		);
	}

	// ── Kamera-flyt ─────────────────────────────────────────────────────────────

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

	function buildTrackingPrompt(tracking: NonNullable<AttachmentTriageResponse['tracking']>) {
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
		]
			.filter(Boolean)
			.join('\n');
	}

	// Handlers for action buttons in triage messages (keyed by action id)
	let pendingActionHandlers: Record<string, () => void> = {};

	function presentAttachmentTriage(result: AttachmentTriageResponse) {
		const attachment = result.attachment;
		const triageText = buildAttachmentTriageText(result.triage);

		// Build action list with stable ids and register handlers
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

		selectedQuickAction = 'chat';
		chatOpen = true;
		returnToChatAfterFlow = false;
		chatPrefill = '';
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
		if (returnToChatAfterFlow) {
			chatOpen = true;
			chatInputAutoFocus = true;
		}
		returnToChatAfterFlow = false;
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
		if (returnToChatAfterFlow) {
			chatOpen = true;
			chatInputAutoFocus = true;
		}
		returnToChatAfterFlow = false;
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

	function startHomeChat(draftOverride?: string) {
		const draft = (draftOverride ?? chatPrefill).trim();
		if (!draft) {
			openChat('', 'chat', { focusInput: true });
			return;
		}

		chatPrefill = '';
		openChat('', 'chat', { focusInput: false });
		void sendChat(draft);
	}

	function startHomeAttachment(
		kind: 'camera' | 'voice' | 'file',
		draftOverride?: string,
		options?: { preserveConversation?: boolean }
	) {
		const draft = (draftOverride ?? chatPrefill).trim();
		if (!options?.preserveConversation) {
			homeChat.reset();
			homeChat.conversationId = null;
			createdThemeLink = null;
		}
		returnToChatAfterFlow = Boolean(options?.preserveConversation);
		chatOpen = false;
		chatInputAutoFocus = false;
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
		if (homeChat.conversationId && homeChat.messages.length > 0) {
			latestClosedConversationId = homeChat.conversationId;
		}
		homeChat.reset();
		homeChat.conversationId = null;
		chatPrefill = '';
		chatInputAutoFocus = false;
		createdThemeLink = null;
		launchingThemeId = null;
		chatOpen = false;
		returnToChatAfterFlow = false;
	}

	function closeCameraFlow() {
		cameraOpen = false;
		cameraSelectedFile = null;
		cameraPreview = null;
		cameraCaption = '';
		cameraError = false;
		if (returnToChatAfterFlow) {
			chatOpen = true;
			chatInputAutoFocus = true;
		}
		returnToChatAfterFlow = false;
	}

	function openWidgetConfigSheet(widget: UserWidget) {
		widgetPanelOpen = false;
		configWidget = widget;
	}

	async function fetchMediaHistory(kind: 'image' | 'audio' | 'document') {
		try {
			const res = await fetch(`/api/media-history?kind=${kind}&limit=12`);
			if (res.ok) {
				const data = await res.json();
				return (data.mediaHistory ?? []) as MediaHistoryItem[];
			}
		} catch (err) {
			console.error('Error fetching media history:', err);
		}
		return [];
	}

	async function loadCameraHistory() {
		cameraHistoryLoading = true;
		cameraHistory = await fetchMediaHistory('image');
		cameraHistoryLoading = false;
	}

	async function loadVoiceHistory() {
		voiceHistoryLoading = true;
		voiceHistory = await fetchMediaHistory('audio');
		voiceHistoryLoading = false;
	}

	async function loadFileHistory() {
		fileHistoryLoading = true;
		fileHistory = await fetchMediaHistory('document');
		fileHistoryLoading = false;
	}

	async function reuseCameraMedia(item: MediaHistoryItem) {
		try {
			cameraPreview = item.url;
			cameraCaption = item.note ?? '';
		} catch (err) {
			console.error('Error reusing camera media:', err);
		}
	}

	async function reuseVoiceMedia(item: MediaHistoryItem) {
		try {
			const res = await fetch(item.url);
			const blob = await res.blob();
			voiceSelectedFile = new File([blob], item.name, { type: item.mimeType });
			voiceText = item.note ?? '';
		} catch (err) {
			console.error('Error reusing voice media:', err);
		}
	}

	async function reuseFileMedia(item: MediaHistoryItem) {
		try {
			const res = await fetch(item.url);
			const blob = await res.blob();
			fileFlowSelected = new File([blob], item.name, { type: item.mimeType });
			fileFlowNote = item.note ?? '';
		} catch (err) {
			console.error('Error reusing file media:', err);
		}
	}

	async function openCreatedTheme(themeId: string) {
		launchingThemeId = themeId;
		await goto(`/tema/${themeId}?handoff=1`);
	}

	function stopChat() {
		homeChat.stop();
	}

	async function sendChat(text: string, imageUrl?: string, attachment?: AttachmentRef) {
		suggestedTheme = null;
		routedToTheme = null;
		await homeChat.send(text, imageUrl, attachment as Parameters<typeof homeChat.send>[2]);
	}

	async function unpinWidget(id: string) {
		const widget = pinnedWidgets.find((w) => w.id === id);
		pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		if (widget) hiddenWidgets = [widget, ...hiddenWidgets];
		writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		const res = await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinned: false })
		});
		if (!res.ok && widget) {
			hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id);
			pinnedWidgets = [widget, ...pinnedWidgets];
			writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		}
	}

	async function repinWidget(id: string) {
		const widget = hiddenWidgets.find((w) => w.id === id);
		hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id);
		if (widget) pinnedWidgets = [...pinnedWidgets, { ...widget, pinned: true }];
		writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);

		const res = await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinned: true })
		});

		if (!res.ok && widget) {
			pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
			hiddenWidgets = [widget, ...hiddenWidgets];
			writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		}
	}

	async function moveWidget(id: string, direction: 'up' | 'down') {
		const index = pinnedWidgets.findIndex((w) => w.id === id);
		if (index === -1) return;
		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= pinnedWidgets.length) return;

		const next = [...pinnedWidgets];
		[next[index], next[targetIndex]] = [next[targetIndex], next[index]];
		pinnedWidgets = next;
		writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);

		await Promise.all(
			next.map((widget, i) =>
				fetch(`/api/user-widgets/${widget.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sortOrder: i })
				})
			)
		);
	}

	async function deleteWidget(id: string) {
		const inPinned = pinnedWidgets.find((w) => w.id === id);
		const inHidden = hiddenWidgets.find((w) => w.id === id);

		if (inPinned) pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		if (inHidden) hiddenWidgets = hiddenWidgets.filter((w) => w.id !== id);
		writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);

		const res = await fetch(`/api/user-widgets/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			if (inPinned) pinnedWidgets = [...pinnedWidgets, inPinned];
			if (inHidden) hiddenWidgets = [...hiddenWidgets, inHidden];
			writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		}
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
			hiddenWidgets = hiddenWidgets.map((w) => w.id === id ? { ...w, ...updated } : w);
			writeCachedPayload(HOME_PINNED_WIDGETS_CACHE_KEY, pinnedWidgets);
		}
	}

	function navigateForWidget(w: UserWidget) {
		const healthMetrics = ['weight', 'sleepDuration', 'steps', 'distance', 'workoutCount', 'heartrate', 'mood'];
		const econMetrics = ['amount'];
		if (healthMetrics.includes(w.metricType)) {
			const t = themes.find((t) => t.name.trim().toLowerCase() === 'helse');
			if (t) { startNavMetric('home', 'tema'); void goto(`/tema/${t.id}`); }
		} else if (econMetrics.includes(w.metricType)) {
			const t = themes.find((t) => t.name.trim().toLowerCase() === 'økonomi');
			startNavMetric('home', 'tema');
			void goto(t ? `/tema/${t.id}` : '/economics');
		} else {
			void goto('/');
		}
	}

	const dateLabel = $derived(
		new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' }).format(new Date())
	);

	// Load media history when flows open
	$effect(() => {
		if (cameraOpen) {
			void loadCameraHistory();
		}
	});

	$effect(() => {
		if (voiceOpen) {
			void loadVoiceHistory();
		}
	});

	$effect(() => {
		if (fileFlowOpen) {
			void loadFileHistory();
		}
	});

	// Fix iOS keyboard scroll: resize fixed overlay to match visual viewport
	$effect(() => {
		if (!inputExpanded) return;
		if (typeof window === 'undefined' || !window.visualViewport) return;
		const vv = window.visualViewport;
		function updateLayout() {
			if (!chatSection) return;
			chatSection.style.height = `${vv.height}px`;
			chatSection.style.top = `${vv.offsetTop}px`;
		}
		vv.addEventListener('resize', updateLayout);
		vv.addEventListener('scroll', updateLayout);
		updateLayout();
		return () => {
			vv.removeEventListener('resize', updateLayout);
			vv.removeEventListener('scroll', updateLayout);
			if (chatSection) {
				chatSection.style.height = '';
				chatSection.style.top = '';
			}
		};
	});
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
	<!-- ── SONE 1: Tittel ── -->
	{#if !inputExpanded}
		<section class="zone zone-title" out:fly={{ y: -24, duration: 750 }} in:fly={{ y: -14, duration: 600 }}>
			<div class="title-row">
				<MorphTitle
					from="Resonans"
					to={dateLabel}
					onpress={() => { startNavMetric('home', 'ukeplan'); void goto('/ukeplan'); }}
					ariaLabel="Åpne ukeplan"
				/>
				<div class="title-right">
					<a href="/goals" class="icon-link" aria-label="Mål"><Icon name="goals" size={20} /></a>
					<a href="/settings" class="icon-link" aria-label="Innstillinger"><Icon name="settings" size={18} /></a>
				</div>
			</div>
			{#if egenfrekvensPromptOpen}
				<EgenfrekvensPrompt
					onstart={() => {
						egenfrekvensPromptOpen = false;
						egenfrekvensFlowOpen = true;
					}}
					ondismiss={() => {
						if (typeof localStorage !== 'undefined' && egenfrekvensPromptDay) {
							localStorage.setItem(`egenfrekvens-prompt-dismissed-${egenfrekvensPromptDay}`, '1');
						}
						egenfrekvensPromptOpen = false;
					}}
				/>
			{/if}
		</section>
	{/if}

	<!-- ── SONE 2: Widgets ── -->
	{#if !inputExpanded}
		<section class="zone zone-widgets" aria-label="Sensor-oversikt" out:fly={{ y: -30, duration: 750 }} in:fly={{ y: -18, duration: 600 }}>
		<button
			class="widget-panel-fab"
			onclick={() => (widgetPanelOpen = !widgetPanelOpen)}
			aria-label="Administrer widgets"
			title="Administrer widgets"
		>
			+
		</button>

		<div class="widget-pager" bind:this={widgetPagerEl} onscroll={handleWidgetPagerScroll}>
			{#each homeWidgetPages as page, pageIndex (`page:${pageIndex}`)}
				<div class="widget-page" role="group" aria-label={`Widget-side ${pageIndex + 1} av ${homeWidgetPages.length}`}>
					<div class="widget-page-grid">
						{#each page as item, itemIndex (item.id)}
							{@const insertDivider =
								itemIndex > 0 &&
								page[itemIndex - 1]?.kind === 'checklist' &&
								item.kind !== 'checklist'}
							{#if insertDivider}
								<div class="widget-page-divider" aria-hidden="true"></div>
							{/if}

							{#if item.kind === 'checklist' && item.checklist}
								{@const isSynthetic = item.checklist.id.startsWith('synthetic:')}
								{@const isMonth = !!item.checklist.context?.startsWith('month:')}
								<ChecklistWidget
									checklist={item.checklist}
									monthDayData={isMonth ? monthDayData : undefined}
									onclick={isSynthetic ? undefined : () => (openChecklist = item.checklist!)}
									onplan={() => handleChecklistPlan(item.checklist?.context ?? null)}
									onremove={isSynthetic ? undefined : async () => {
										if (!item.checklist) return;
										await fetch(`/api/checklists/${item.checklist.id}`, { method: 'DELETE' });
										activeChecklists = activeChecklists.filter((c) => c.id !== item.checklist?.id);
									}}
								/>
							{:else if item.kind === 'skeleton'}
								<div class="widget-skeleton" style:animation-delay="{(item.skeletonIndex ?? 0) * 120}ms"></div>
							{:else if item.kind === 'dynamic' && item.widget}
								<DynamicWidget
									widgetId={item.widget.id}
									title={item.widget.title}
									unit={item.widget.unit}
									color={item.widget.color}
									pinned={item.widget.pinned}
									onpress={() => navigateForWidget(item.widget!)}
									onchat={(summary) => openChat(summary)}
									onunpin={() => unpinWidget(item.widget!.id)}
									onconfig={() => openWidgetConfigSheet(item.widget!)}
								/>
							{:else if item.kind === 'partner'}
								<div class="partner-onboarding-card widget-item-full">
									<p class="partner-onboarding-kicker">Partnermodus aktivert</p>
									<h3>Kom i gang sammen i stedet for tomme widgets</h3>
									<p>
										Start med en felles oppstartsplan for parforhold og samliv, så bygger vi widgets etter det som faktisk er viktig for dere.
									</p>
									<div class="partner-onboarding-actions">
										<button class="partner-onboarding-btn primary" onclick={openPartnerOnboardingChat}>Start partner-onboarding</button>
										<button class="partner-onboarding-btn" onclick={() => goto('/ukeplan')}>Åpne ukeplan sammen</button>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>

		{#if homeWidgetPages.length > 1}
			<div class="widget-pager-dots" aria-label="Widget-sider">
				{#each homeWidgetPages as _, i (`dot:${i}`)}
					<button
						class="widget-pager-dot"
						class:is-active={i === currentWidgetPage}
						onclick={() => goToWidgetPage(i)}
						aria-label={`Gå til widget-side ${i + 1}`}
						aria-current={i === currentWidgetPage ? 'true' : undefined}
					></button>
				{/each}
			</div>
		{/if}

		</section>
	{/if}

	<!-- ── SONE 3: Tema ── -->
	{#if !inputExpanded}
		<section
			class="zone zone-tema"
			aria-label="Temaer"
			out:fly={{ y: -34, duration: 750 }}
			in:fly={{ y: -22, duration: 600 }}
			onpointerdown={handleTemaPressStart}
			onpointerup={handleTemaPressEnd}
			onpointerleave={handleTemaPressEnd}
			onpointercancel={handleTemaPressEnd}
		>
		<p class="zone-label">Temaer</p>
		{#if relationshipOnboardingActive}
			<div class="partner-onboarding-card partner-onboarding-card-theme">
				<p class="partner-onboarding-kicker">Felles start</p>
				<h3>Sett retning for parforholdet deres</h3>
				<p>
					Lag et eget tema for samliv, prioriteringer og ukerytme. Derfra kan dere bygge mål, samtaler og oppgaver sammen.
				</p>
				<div class="partner-onboarding-actions">
					{#if relationshipTheme}
						<button class="partner-onboarding-btn primary" onclick={() => goto(`/tema/${relationshipTheme.id}`)}>Åpne partnertema</button>
					{:else}
						<button class="partner-onboarding-btn primary" onclick={openPartnerOnboardingChat}>Opprett partnertema</button>
					{/if}
					<button class="partner-onboarding-btn" onclick={() => goto('/samtaler')}>Åpne samtaler</button>
				</div>
			</div>
		{/if}
		{#if themes.length}
			<div class="tema-v3-grid">
				{#each themes.slice(0, 6) as theme}
					<button class="tema-btn-v3" style={getThemeHueStyle(theme.name)} onclick={() => { if (temaPressBlocked) return; startNavMetric('home', 'tema'); void goto(`/tema/${theme.id}`); }}>
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
	{/if}

	<!-- ── Handlingssone: prioriterte aktuelle handlinger (karusell) ── -->
	{#if !inputExpanded && actionItems.length > 0}
		<section class="zone-actions" aria-label="Foreslåtte handlinger">
			<div class="action-carousel">
				{#each actionItems as item (item.id)}
					<button
						class="action-pill"
						class:is-done={item.done}
						onclick={item.onclick}
					>
						<span class="action-pill-icon">{item.icon}</span>
						<span class="action-pill-label">{item.label}</span>
						{#if item.value !== undefined}
							<span class="action-pill-val">{item.value}</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ── SONE 4: Chat ── -->
	<section class="zone zone-input" class:zone-chat-open={inputExpanded} aria-label="Chat" bind:this={chatSection}>
		{#if chatOpen}
			<PageHeader
				title={hasPersistedConversation ? 'Samtale' : 'Samtaler'}
				subtitle={hasPersistedConversation ? chatConversationTitle : ''}
				backHref={hasPersistedConversation ? '/samtaler' : undefined}
				backLabel="Alle samtaler"
				onTitleClick={!hasPersistedConversation ? closeChat : undefined}
			>
				{#snippet actions()}
					{#if hasPersistedConversation}
						<button class="chat-link" onclick={() => goto(`/samtaler?conversation=${homeChat.conversationId}`)} aria-label="Åpne denne samtalen">Åpne</button>
					{/if}
					<button
						class="model-pill"
						onclick={() => {
							const opts = ['auto', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5.4'];
							selectedChatModel = opts[(opts.indexOf(selectedChatModel) + 1) % opts.length];
							if (typeof localStorage !== 'undefined') localStorage.setItem('chat-model', selectedChatModel);
						}}
						title="Modell — klikk for å bytte"
					>{{ 'auto': 'Auto', 'gpt-4o-mini': 'Mini', 'gpt-4.1': '4.1', 'gpt-5.4': '5.4' }[selectedChatModel] ?? selectedChatModel}</button>
				{/snippet}
			</PageHeader>
			<div class="chat-messages" aria-live="polite">
				{#if homeChat.messages.length === 0 && !homeChat.loading}
					{#if followUpConversations.length > 0}
						<div class="followup-list" aria-label="Nylige samtaler å følge opp">
							{#snippet followupItem(convo: typeof followUpConversations[0])}
								<div class="followup-item-wrap" style={convo.linkedTheme ? getThemeHueStyle(convo.linkedTheme.name) : undefined}>
									{#if homeEditingConversationId === convo.id}
										<input
											class="followup-rename-input"
											bind:value={homeEditingTitle}
											onkeydown={(e) => {
												if (e.key === 'Enter') commitHomeConversationRename(convo.id);
												if (e.key === 'Escape') cancelHomeConversationRename();
											}}
											onblur={() => commitHomeConversationRename(convo.id)}
											autofocus
										/>
									{:else}
										<button class="followup-item" onclick={() => goto(`/samtaler?conversation=${convo.id}`)}>
											<span class="followup-title">{convo.title}</span>
											<span class="followup-date">{formatFollowUpDate(convo.updatedAt)}</span>
											{#if convo.preview}
												<span class="followup-preview">{convo.preview}</span>
											{/if}
										</button>
									{/if}
									<ConversationContextMenu
										conversationId={convo.id}
										starred={convo.starred}
										archived={convo.archived}
										currentThemeId={convo.linkedTheme?.id ?? null}
										themes={themes}
										onStarred={setHomeConversationStarred}
										onArchived={setHomeConversationArchived}
										onDeleted={removeHomeConversation}
										onMovedToTheme={moveHomeConversationTheme}
										onStartRename={() => startHomeConversationRename(convo.id, convo.title)}
									/>
								</div>
							{/snippet}

							{#if followUpStarred.length > 0}
								<CollapsibleSection title="Stjernemerkede" count={followUpStarred.length} defaultOpen={true}>
									{#each followUpStarred as convo (convo.id)}
										{@render followupItem(convo)}
									{/each}
								</CollapsibleSection>
							{/if}

							<CollapsibleSection title="Samtaler" count={followUpRegular.length} defaultOpen={true}>
								{#if followUpRegular.length === 0}
									<p class="followup-empty">Ingen umerkede samtaler.</p>
								{:else}
									{#each followUpRegular as convo (convo.id)}
										{@render followupItem(convo)}
									{/each}
								{/if}
							</CollapsibleSection>
						</div>
					{/if}
				{/if}
				<ChatMessages
					messages={homeChat.messages}
					streamingText={homeChat.streamingText}
					streamingSteps={homeChat.streamingSteps}
					loading={homeChat.loading}
					stopped={homeChat.stopped}
					stoppedText={homeChat.stoppedText}
					error={homeChat.error}
					lastUserMsgId={homeChat.lastUserMsgId}
					onRetry={() => homeChat.retry()}
					onAction={(id) => pendingActionHandlers[id]?.()}
				/>
			</div>
			<div class="chat-input-area">
				{#if routedToTheme}
					{@const theme = routedToTheme}
					<div class="theme-routing-banner routed">
						<span class="theme-routing-icon">✓</span>
						<span class="theme-routing-text">Melding automatisk koblet til tema: <strong>{theme.themeName}</strong></span>
						<button class="theme-routing-dismiss" onclick={() => (routedToTheme = null)}>✕</button>
					</div>
				{/if}
				{#if suggestedTheme && !routedToTheme}
					{@const theme = suggestedTheme}
					<div class="theme-routing-banner suggested">
						<span class="theme-routing-icon">💡</span>
						<span class="theme-routing-text">Foreslår å koble til tema: <strong>{theme.themeName}</strong></span>
						<div class="theme-routing-actions">
							<button class="theme-routing-accept" onclick={() => {
								// Naviger til temaet
								goto(`/tema/${theme.themeId}`);
							}}>Gå til tema</button>
							<button class="theme-routing-dismiss" onclick={() => (suggestedTheme = null)}>Avvis</button>
						</div>
					</div>
				{/if}
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
				{#key `${activeQuickAction.id}:${chatInputAutoFocus ? 'focus' : 'nofocus'}`}
					<ChatInput
						placeholder={activeQuickAction.placeholder}
						initialValue={chatPrefill}
						autoFocus={chatInputAutoFocus}
						showActionRig={true}
						streaming={homeChat.loading}
						onStop={stopChat}
						onAttachment={(kind, draft) => startHomeAttachment(kind, draft, { preserveConversation: true })}
						onMood={(draft) => openEgenfrekvensFlow(draft, true)}
						onTextChange={(text) => (chatPrefill = text)}
						onBackspaceEmpty={closeChat}
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
						{#if cameraHistory.length > 0}
							<div class="media-history">
								<p class="media-history-label">Tidligere bilder</p>
								<div class="media-history-grid">
									{#each cameraHistory as item}
										<button
											class="media-history-item"
											onclick={() => reuseCameraMedia(item)}
											title={item.name}
											aria-label={`Gjenbruk: ${item.name}`}
										>
											<img src={item.url} alt={item.name} />
											<span class="media-item-name">{item.name.split('.')[0].slice(0, 10)}</span>
										</button>
									{/each}
								</div>
							</div>
						{:else if cameraHistoryLoading}
							<p class="media-history-loading">Laster tidligere bilder…</p>
						{/if}
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
					accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov,.m4v"
					class="sr-only"
					onchange={handleVoiceFileSelect}
				/>
				<div class="flow-body">
					{#if !voiceSelectedFile}
						<button class="upload-zone" onclick={() => voiceFileInput?.click()}>
							<span class="upload-zone-icon"><Icon name="wave" size={28} /></span>
							<p class="upload-zone-label">Velg lyd- eller videofil</p>
							<p class="upload-zone-sub">Opptak · talememo · møteklipp · skjermopptak med lyd</p>
						</button>
						{#if voiceHistory.length > 0}
							<div class="media-history">
								<p class="media-history-label">Tidligere lydopptak</p>
								<div class="media-history-list">
									{#each voiceHistory as item}
										<button
											class="media-history-list-item"
											onclick={() => reuseVoiceMedia(item)}
											title={item.name}
											aria-label={`Gjenbruk: ${item.name}`}
										>
											<span class="media-list-icon">🎙️</span>
											<div class="media-list-meta">
												<span class="media-list-name">{item.name}</span>
												<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
											</div>
										</button>
									{/each}
								</div>
							</div>
						{:else if voiceHistoryLoading}
							<p class="media-history-loading">Laster tidligere opptak…</p>
						{/if}
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
						{#if fileHistory.length > 0}
							<div class="media-history">
								<p class="media-history-label">Tidligere filer</p>
								<div class="media-history-list">
									{#each fileHistory as item}
										<button
											class="media-history-list-item"
											onclick={() => reuseFileMedia(item)}
											title={item.name}
											aria-label={`Gjenbruk: ${item.name}`}
										>
											<span class="media-list-icon">📄</span>
											<div class="media-list-meta">
												<span class="media-list-name">{item.name}</span>
												<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
											</div>
										</button>
									{/each}
								</div>
							</div>
						{:else if fileHistoryLoading}
							<p class="media-history-loading">Laster tidligere filer…</p>
						{/if}
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
			<ChatInput
				placeholder="Hva tenker du på?"
				initialValue={chatPrefill}
				showActionRig={true}
				interceptOpen={true}
				onOpen={() => openChat(chatPrefill, 'chat', { focusInput: true })}
				onAttachment={(kind, draft) => startHomeAttachment(kind, draft)}
				onMood={(draft) => openEgenfrekvensFlow(draft, false)}
				onTextChange={(text) => (chatPrefill = text)}
				onsubmit={(message) => startHomeChat(message)}
			/>
		{/if}
	</section>

</div>
</PullToRefresh>

{#if widgetPanelOpen}
	<div class="widget-sheet-backdrop" onclick={() => (widgetPanelOpen = false)} aria-hidden="true"></div>
	<section class="widget-panel" aria-label="Administrer widgets">
		<div class="widget-panel-handle" aria-hidden="true"></div>
		<div class="widget-panel-head">
			<p>Widget-panel</p>
			<button class="widget-panel-close" onclick={() => (widgetPanelOpen = false)}>Lukk</button>
		</div>

		<div class="widget-panel-content">
			<div class="widget-panel-section">
				<p class="widget-panel-title">På hjemskjerm</p>
				{#if pinnedWidgets.length === 0}
					<p class="widget-panel-empty">Ingen aktive widgets</p>
				{:else}
					{#each pinnedWidgets as w, i (w.id)}
						<div class="widget-panel-row">
							<span class="widget-panel-name">{w.title}</span>
							<div class="widget-panel-actions">
								<button class="widget-btn" onclick={() => openWidgetConfigSheet(w)}>Konfig</button>
								<button class="widget-btn" onclick={() => moveWidget(w.id, 'up')} disabled={i === 0}>↑</button>
								<button class="widget-btn" onclick={() => moveWidget(w.id, 'down')} disabled={i === pinnedWidgets.length - 1}>↓</button>
								<button class="widget-btn" onclick={() => unpinWidget(w.id)}>Fjern</button>
								<button class="widget-btn widget-btn-danger" onclick={() => deleteWidget(w.id)}>Slett</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="widget-panel-section">
				<p class="widget-panel-title">Skjulte widgets</p>
				{#if hiddenWidgets.length === 0}
					<p class="widget-panel-empty">Ingen skjulte widgets</p>
				{:else}
					{#each hiddenWidgets as w (w.id)}
						<div class="widget-panel-row">
							<span class="widget-panel-name">{w.title}</span>
							<div class="widget-panel-actions">
								<button class="widget-btn" onclick={() => openWidgetConfigSheet(w)}>Konfig</button>
								<button class="widget-btn" onclick={() => repinWidget(w.id)}>Legg til</button>
								<button class="widget-btn widget-btn-danger" onclick={() => deleteWidget(w.id)}>Slett</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</section>
{/if}

<!-- ── TEMA PANEL ── -->
{#if themePanelOpen}
	<div class="widget-sheet-backdrop" onclick={() => (themePanelOpen = false)} aria-hidden="true"></div>
	<section class="widget-panel" aria-label="Temaer">
		<div class="widget-panel-handle" aria-hidden="true"></div>
		<div class="widget-panel-head">
			<p>Temaer</p>
			<button class="widget-panel-close theme-panel-close" onclick={() => (themePanelOpen = false)} aria-label="Lukk"><Icon name="close" size={14} /></button>
		</div>
		<div class="widget-panel-content">
			<div class="widget-panel-section">
				{#each themes as theme (theme.id)}
					<div
						class="tema-panel-row"
						class:tema-panel-row-dragover={dragOverThemeId === theme.id}
						style={getThemeHueStyle(theme.name)}
						draggable="true"
						role="listitem"
						ondragstart={() => handleThemeDragStart(theme.id)}
						ondragover={(e) => handleThemeDragOver(e, theme.id)}
						ondrop={() => handleThemeDrop(theme.id)}
						ondragend={() => { dragThemeId = null; dragOverThemeId = null; }}
					>
						<span class="tema-panel-row-handle" aria-hidden="true">⠿</span>
						<button
							class="tema-panel-row-btn"
							onclick={() => { themePanelOpen = false; startNavMetric('home', 'tema'); void goto(`/tema/${theme.id}`); }}
						>
							<span class="tema-panel-row-icon">{theme.emoji}</span>
							<span class="tema-panel-row-name">{theme.name}</span>
							<span class="tema-panel-row-arrow">→</span>
						</button>
					</div>
				{/each}
			</div>
		</div>
	</section>
{/if}

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
		onChanged={() => {
			void fetchChecklists();
		}}
		onDeleted={() => {
			activeChecklists = activeChecklists.filter((c) => c.id !== openChecklist?.id);
			openChecklist = null;
		}}
		onStartChat={async (itemText, checklistId, itemId) => {
			openChecklist = null;
			try {
				const res = await fetch('/api/conversations/new', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: itemText,
						sourceContext: { sourceChecklistId: checklistId, sourceItemId: itemId, sourceItemText: itemText }
					})
				});
				if (res.ok) {
					const { conversationId } = await res.json();
					goto(`/samtaler?conversation=${conversationId}`);
				} else {
					goto('/samtaler');
				}
			} catch {
				goto('/samtaler');
			}
		}}
	/>
{/if}

<!-- ── PLANLEGGINGSFLYTER FRA TOM SJEKKLISTE ── -->
{#if homeDayPlanOpen}
	<FlowSheet
		flow={FLOWS['day_plan']}
		context={{ dayIso: homeDayPlanIso, weekDashedKey: homeDayPlanWeekKey }}
		onclose={() => (homeDayPlanOpen = false)}
		oncomplete={async () => {
			homeDayPlanOpen = false;
			await fetchChecklists();
		}}
	/>
{/if}

{#if homeWeekPlanOpen}
	<FlowSheet
		flow={FLOWS['planning_week_plan']}
		onclose={() => (homeWeekPlanOpen = false)}
		oncomplete={async () => {
			homeWeekPlanOpen = false;
			await fetchChecklists();
		}}
	/>
{/if}

{#if homeMonthPlanOpen}
	<FlowSheet
		flow={FLOWS['planning_month_plan']}
		context={homeMonthPlanContext}
		onclose={() => (homeMonthPlanOpen = false)}
		oncomplete={async () => {
			homeMonthPlanOpen = false;
			await fetchChecklists();
		}}
	/>
{/if}

{#if egenfrekvensFlowOpen}
	<FlowSheet
		flow={FLOWS['egenfrekvens_checkin']}
		context={{
			slot: egenfrekvensActiveSlot,
			...(egenfrekvensInitialNote ? { initialData: { note: egenfrekvensInitialNote } } : {}),
			...(egenfrekvensReflectionPrompt ? { systemPrompts: { reflection: egenfrekvensReflectionPrompt } } : {}),
			...(egenfrekvensDreamReasons ? { dreamReasons: egenfrekvensDreamReasons } : {})
		}}
		onclose={() => {
			egenfrekvensFlowOpen = false;
			egenfrekvensInitialNote = '';
			egenfrekvensReflectionPrompt = null;
			egenfrekvensDreamReasons = null;
			if (returnToChatAfterFlow) {
				chatOpen = true;
				chatInputAutoFocus = true;
			}
			returnToChatAfterFlow = false;
		}}
		oncomplete={() => {
			egenfrekvensFlowOpen = false;
			egenfrekvensPromptOpen = false;
			egenfrekvensInitialNote = '';
			egenfrekvensReflectionPrompt = null;
			egenfrekvensDreamReasons = null;
			if (returnToChatAfterFlow) {
				chatOpen = true;
				chatInputAutoFocus = true;
			}
			returnToChatAfterFlow = false;
		}}
	/>
{/if}

{#if egenfrekvensQuickFlowOpen}
	<FlowSheet
		flow={FLOWS['egenfrekvens_quick']}
		context={{ slot: egenfrekvensActiveSlot }}
		onclose={() => {
			egenfrekvensQuickFlowOpen = false;
		}}
		oncomplete={() => {
			egenfrekvensQuickFlowOpen = false;
			egenfrekvensPromptOpen = false;
			void loadEgenfrekvensRecent();
		}}
	/>
{/if}

<style>
	/* ── Grunnlayout ── */
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

	/* ── Soner ── */
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}


	/* ── Tittel-sone (10 %) ── */
	.zone-title {
		flex: 10 0 0;
		min-height: 0;
		display: flex;
		align-items: flex-start;
		padding:
			var(--screen-title-top-pad, 34px)
			max(16px, env(safe-area-inset-right, 0px))
			0
			max(16px, env(safe-area-inset-left, 0px));
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-width: 0;
		gap: 8px;
	}

	.title-row :global(.morph-title) {
		min-width: 0;
		flex: 1 1 auto;
	}

	.title-row :global(.morph-title-text) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-right {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
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

	/* ── Widget-sone (28 %) — kort med avrundede hjørner ── */
	.zone-widgets {
		flex: 28 0 0;
		min-height: 0;
		padding: 10px 14px 8px;
		background: #171717;
		border-radius: 18px;
		margin: 0 12px;
		position: relative;
	}

	/* ── Tema-sone (24 %) ── */
	.zone-tema {
		flex: 24 0 0;
		min-height: 0;
		padding: 6px 16px 4px;
		position: relative;
	}

	.zone-actions {
		flex: 0 0 auto;
		padding: 4px 0 8px;
	}

	.action-carousel {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x proximity;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		padding: 0 16px;
	}

	.action-carousel::-webkit-scrollbar {
		display: none;
	}

	.action-carousel > .action-pill {
		flex: 0 0 auto;
		scroll-snap-align: start;
	}

	.action-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: hsl(228 19% 11%);
		border: 1px solid hsl(228 16% 18%);
		border-radius: 999px;
		padding: 8px 14px;
		cursor: pointer;
		font: inherit;
		color: hsl(228 22% 80%);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		transition: background 0.15s, border-color 0.15s, transform 0.15s;
	}

	.action-pill:hover {
		background: hsl(228 22% 14%);
		border-color: hsl(228 28% 34%);
		transform: translateY(-1px);
	}

	.action-pill.is-done {
		opacity: 0.7;
	}

	.action-pill-icon {
		font-size: 0.95rem;
		line-height: 1;
	}

	.action-pill-val {
		margin-left: 6px;
		padding: 2px 7px;
		background: hsl(228 28% 22%);
		border-radius: 999px;
		color: #e2e8f0;
		font-weight: 700;
	}

	/* ── Zone-label ── */
	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 6px;
	}


	/* ── Widget-pager ── */
	.widget-pager {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		height: 100%;
	}

	.widget-pager::-webkit-scrollbar {
		display: none;
	}

	.widget-page {
		flex: 0 0 100%;
		scroll-snap-align: start;
		min-width: 100%;
		padding-top: 6px;
	}

	.widget-page-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: center;
		align-content: flex-start;
		min-height: 100%;
		padding: 0 28px 16px 0;
		box-sizing: border-box;
	}

	.widget-page-divider {
		flex: 0 0 100%;
		height: 1px;
		background: #202020;
		margin: -2px 6px 2px;
	}

	.widget-item-full {
		flex: 0 0 100%;
	}

	.widget-pager-dots {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		gap: 6px;
		z-index: 3;
	}

	.widget-pager-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: none;
		background: #353535;
		cursor: pointer;
		padding: 0;
	}

	.widget-pager-dot.is-active {
		background: #7c8ef5;
	}

	.widget-panel-fab {
		position: absolute;
		right: 10px;
		bottom: 10px;
		z-index: 4;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid #3a3a3a;
		background: #101010;
		color: #d8d8d8;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
	}

	.widget-panel-fab:hover {
		border-color: #4a5af0;
		color: #ffffff;
	}

	.widget-sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 39;
		background: rgba(0, 0, 0, 0.52);
	}

	.widget-panel {
		position: fixed;
		left: 10px;
		right: 10px;
		bottom: calc(8px + env(safe-area-inset-bottom, 0px));
		z-index: 40;
		max-height: min(72dvh, 560px);
		background: #111;
		border: 1px solid #2b2b2b;
		border-radius: 18px;
		padding: 8px 10px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: hidden;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
	}

	.widget-panel-handle {
		width: 40px;
		height: 4px;
		margin: 2px auto 6px;
		border-radius: 999px;
		background: #333;
	}

	.widget-panel-content {
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow: auto;
		padding-right: 2px;
	}

	.widget-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.widget-panel-head p {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: #e6e6e6;
	}

	.widget-panel-close {
		border: 1px solid #333;
		background: #191919;
		color: #cfcfcf;
		border-radius: 999px;
		padding: 3px 10px;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.widget-panel-close:hover {
		border-color: #4a5af0;
		color: #fff;
	}

	.theme-panel-close {
		width: 32px;
		height: 32px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.widget-panel-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.widget-panel-title {
		margin: 0;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #7a7a7a;
	}

	.widget-panel-empty {
		margin: 0;
		font-size: 0.74rem;
		color: #727272;
	}

	.widget-panel-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 8px;
		background: #171717;
		border: 1px solid #272727;
		border-radius: 10px;
	}

	.widget-panel-name {
		font-size: 0.76rem;
		color: #d6d6d6;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.widget-panel-actions {
		display: flex;
		gap: 4px;
	}

	.widget-btn {
		border: 1px solid #333;
		background: #1f1f1f;
		color: #ccc;
		border-radius: 8px;
		padding: 3px 7px;
		font-size: 0.68rem;
		cursor: pointer;
	}

	.widget-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.widget-btn-danger {
		border-color: #5a2e2e;
		color: #ffb4b4;
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

	.partner-onboarding-card {
		width: 100%;
		padding: 14px;
		border-radius: 14px;
		background: linear-gradient(155deg, rgba(51, 86, 153, 0.24), rgba(25, 29, 40, 0.9));
		border: 1px solid rgba(130, 160, 255, 0.32);
		box-shadow: 0 14px 26px rgba(6, 8, 14, 0.28);
	}

	.partner-onboarding-card-theme {
		margin-bottom: 10px;
	}

	.partner-onboarding-kicker {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #9fb8ff;
	}

	.partner-onboarding-card h3 {
		margin: 6px 0 8px;
		font-size: 1rem;
		line-height: 1.3;
		color: #ecf2ff;
	}

	.partner-onboarding-card p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: #d2daee;
	}

	.partner-onboarding-actions {
		margin-top: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.partner-onboarding-btn {
		border: 1px solid rgba(180, 198, 240, 0.3);
		background: rgba(13, 16, 26, 0.6);
		color: #dce4f6;
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.partner-onboarding-btn.primary {
		background: linear-gradient(145deg, #5476ef, #4364d9);
		border-color: transparent;
		color: #fff;
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

	/* ── Tema-panel: full liste ── */
	.tema-panel-row {
		--theme-hue: 228;
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 12px;
		margin-bottom: 6px;
		background: linear-gradient(90deg, hsl(var(--theme-hue) 20% 11%) 0%, hsl(var(--theme-hue) 18% 9%) 100%);
		transition: background 0.12s, opacity 0.12s;
		cursor: grab;
	}

	.tema-panel-row:active { cursor: grabbing; }

	.tema-panel-row-dragover {
		opacity: 0.5;
	}

	.tema-panel-row-handle {
		padding: 0 4px 0 10px;
		color: #333;
		font-size: 1rem;
		flex-shrink: 0;
		line-height: 1;
		cursor: grab;
	}

	.tema-panel-row-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		padding: 11px 14px 11px 0;
		cursor: pointer;
		font: inherit;
		color: #ddd;
		text-align: left;
	}

	.tema-panel-row:hover {
		background: linear-gradient(90deg, hsl(var(--theme-hue) 24% 14%) 0%, hsl(var(--theme-hue) 20% 11%) 100%);
	}

	.tema-panel-row-icon {
		font-size: 1.2rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.tema-panel-row-name {
		flex: 1;
		font-size: 0.9rem;
		font-weight: 600;
		color: hsl(var(--theme-hue) 22% 80%);
	}

	.tema-panel-row-arrow {
		color: #444;
		font-size: 0.85rem;
	}

	/* ── Tema v3: 3-kolonne grid med kompakte knapper ── */
	.tema-v3-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.tema-btn-v3 {
		--theme-hue: 228;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: hsl(var(--theme-hue) 19% 11%);
		border: none;
		border-radius: 14px;
		padding: 8px 6px;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
		font: inherit;
		color: #ddd;
	}

	.tema-btn-v3:hover {
		background: hsl(var(--theme-hue) 22% 14%);
		box-shadow: 0 8px 20px hsl(var(--theme-hue) 55% 18% / 0.2);
		transform: translateY(-1px);
	}

	.tema-btn-v3-icon {
		font-size: 1.15rem;
		line-height: 1;
		filter: drop-shadow(0 2px 8px hsl(var(--theme-hue) 70% 18% / 0.25));
	}

	.tema-btn-v3-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: hsl(var(--theme-hue) 22% 80%);
		opacity: 0.8;
	}

	/* ── Input-sone (28 %) — kort med avrundede hjørner ── */
	.zone-input {
		flex: 28 0 0;
		min-height: 0;
		padding: 8px 14px;
		padding-bottom: calc(8px + env(safe-area-inset-bottom, 8px));
		background: #171717;
		border-radius: 18px;
		margin: 0 12px;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		box-sizing: border-box;
		overflow: hidden;
		transition: border-radius 300ms cubic-bezier(0.22, 1, 0.36, 1), margin 300ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.zone-chat-open {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: #0f0f0f;
		border-radius: 0;
		margin: 0;
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

	:global(.zone-input .page-header) {
		padding: var(--screen-title-top-pad, 34px) 20px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		flex-direction: row !important;
		align-items: center !important;
		--text-primary: #eee;
		--text-secondary: #aaa;
	}

	:global(.zone-input .page-header h1) {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	:global(.zone-input .page-header-actions) {
		width: auto !important;
	}

	.model-pill {
		padding: 2px 9px;
		border-radius: 999px;
		border: 1px solid #252525;
		background: #111;
		color: #555;
		font-size: 0.68rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.model-pill:hover {
		border-color: #333;
		color: #999;
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

	@media (prefers-reduced-motion: reduce) {
		.zone-input {
			transition: none;
		}
	}


	.followup-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		opacity: 0.58;
		margin-top: 2px;
	}

	.followup-item-wrap {
		display: flex;
		align-items: stretch;
		border: 1px solid #1a1a1a;
		border-radius: 10px;
		overflow: visible;
		transition: border-color 0.15s ease, color 0.15s ease;
	}

	.followup-item-wrap:hover {
		border-color: #2b2b2b;
	}

	.followup-item {
		text-align: left;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'title date'
			'preview preview';
		gap: 3px 10px;
		padding: 9px 10px;
		background: transparent;
		border: none;
		border-radius: 10px 0 0 10px;
		color: #7a7a7a;
		cursor: pointer;
		transition: opacity 0.15s ease, color 0.15s ease;
		flex: 1;
		min-width: 0;
	}

	.followup-item:hover {
		opacity: 0.9;
		color: #9a9a9a;
	}

	.followup-rename-input {
		flex: 1;
		min-width: 0;
		background: #131313;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 9px 10px;
		margin: 4px;
		color: #d2d2d2;
		font: inherit;
		font-size: 0.79rem;
		font-weight: 600;
		outline: none;
	}

	.followup-empty {
		margin: 0;
		padding: 8px 10px;
		font-size: 0.72rem;
		color: #646464;
		font-style: italic;
	}

	.followup-title {
		grid-area: title;
		font-size: 0.79rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.followup-date {
		grid-area: date;
		font-size: 0.7rem;
		color: #666;
	}

	.followup-preview {
		grid-area: preview;
		font-size: 0.72rem;
		line-height: 1.3;
		color: #666;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	.chat-input-area {
		position: sticky;
		bottom: 0;
		padding: 10px 14px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		background: linear-gradient(180deg, rgba(15, 15, 15, 0.72) 0%, #0f0f0f 18%);
		backdrop-filter: blur(10px);
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

	.theme-routing-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border-radius: 12px;
		padding: 10px 12px;
		font-size: 0.8rem;
		animation: slideIn 0.3s ease;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.theme-routing-banner.routed {
		background: hsl(142 30% 12%);
		border: 1px solid hsl(142 35% 22%);
		color: hsl(142 50% 82%);
	}

	.theme-routing-banner.suggested {
		background: hsl(45 28% 12%);
		border: 1px solid hsl(45 32% 24%);
		color: hsl(45 48% 84%);
		flex-wrap: wrap;
	}

	.theme-routing-icon {
		flex-shrink: 0;
		font-size: 1.1rem;
	}

	.theme-routing-text {
		flex: 1;
		min-width: 0;
	}

	.theme-routing-text strong {
		font-weight: 600;
	}

	.theme-routing-actions {
		display: flex;
		gap: 6px;
		width: 100%;
		margin-top: 4px;
	}

	.theme-routing-accept {
		flex: 1;
		background: hsl(45 35% 18%);
		border: 1px solid hsl(45 38% 28%);
		color: hsl(45 50% 88%);
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.theme-routing-accept:hover {
		background: hsl(45 38% 22%);
		border-color: hsl(45 42% 35%);
	}

	.theme-routing-dismiss {
		background: transparent;
		border: none;
		color: inherit;
		opacity: 0.6;
		padding: 2px 6px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: opacity 0.15s ease;
	}

	.theme-routing-dismiss:hover {
		opacity: 1;
	}

	.suggested .theme-routing-dismiss {
		flex: 0 0 auto;
		padding: 6px 10px;
		background: hsla(0 0% 100% / 0.08);
		border: 1px solid hsla(0 0% 100% / 0.12);
		border-radius: 8px;
		font-size: 0.75rem;
	}

	.suggested .theme-routing-dismiss:hover {
		background: hsla(0 0% 100% / 0.12);
	}



	/* Media history gallery */
	.media-history {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid #2a2a2a;
	}

	.media-history-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 10px 0;
	}

	.media-history-loading {
		font-size: 0.75rem;
		color: #666;
		margin: 8px 0;
	}

	.media-history-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.media-history-item {
		aspect-ratio: 1;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		overflow: hidden;
		cursor: pointer;
		background: #0f0f0f;
		transition: border-color 0.15s, opacity 0.15s;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 0;
		font: inherit;
	}

	.media-history-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.media-history-item:hover {
		border-color: #4a5af0;
		opacity: 0.85;
	}

	.media-item-name {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.8);
		color: #ccc;
		font-size: 0.65rem;
		padding: 3px 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
	}

	.media-history-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.media-history-list-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
		text-align: left;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.media-history-list-item:hover {
		border-color: #4a5af0;
		background: rgba(74, 90, 240, 0.05);
	}

	.media-list-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.media-list-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.media-list-name {
		font-size: 0.8rem;
		font-weight: 500;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-list-date {
		font-size: 0.7rem;
		color: #666;
	}
</style>


