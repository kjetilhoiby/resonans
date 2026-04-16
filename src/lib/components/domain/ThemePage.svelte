<!--
  ThemePage — tre-tab-visning for ett tema.
	Tabs: Chat | Data | Mål | Flyter | Filer | Lister (reise)

  Props:
    theme           tema-objekt fra DB
    initialMessages meldinger for dette temaets samtale
    goals           aktive mål koblet til temaet
    conversationId  UUID til temaets conversation (for API-kall)
-->
<script lang="ts">
	import { goto, preloadCode } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ChatInput from '../ui/ChatInput.svelte';
	import HealthDashboard from './HealthDashboard.svelte';
	import EconomicsDashboard from './EconomicsDashboard.svelte';
	import TripDashboard from './TripDashboard.svelte';
	import TripListsPanel from './TripListsPanel.svelte';
	import BookDashboard from './BookDashboard.svelte';
	import ScreenTitle from '../ui/ScreenTitle.svelte';
	import Icon from '../ui/Icon.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import GoalRing from '../ui/GoalRing.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { fetchDashboard, getCachedDashboard, type EconomicsDashboardData, type HealthDashboardData, type TravelDashboardData } from '$lib/client/dashboard-cache';
	import { getThemeDashboardDefinition, resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
	import { finishNavMetric, startNavMetric } from '$lib/client/nav-metrics';
	import { streamProxyChat } from '$lib/client/proxy-chat-stream';
	import FlowCard from '../flows/FlowCard.svelte';
	import FlowSheet from '../flows/FlowSheet.svelte';
	import { getFlowsByTheme } from '$lib/flows/registry';
	import type { Flow } from '$lib/flows/types';

	/* ── Types ──────────────────────────────────────────── */
	interface Theme {
		id: string;
		name: string;
		emoji: string | null;
		parentTheme?: string | null;
		description?: string | null;
	}

	interface Message {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp: string;
	}

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
	}

	interface ThemeConversation {
		id: string;
		title: string;
		preview: string | null;
		updatedAt: string;
		createdAt: string;
	}

	interface SelectedWorkout {
		id: string;
		timestamp: string;
		sportType: string;
		title: string;
		distanceMeters: number | null;
		distanceKm: number | null;
		durationSeconds: number | null;
		paceSecondsPerKm: number | null;
		elevationMeters: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		source: string | null;
		sourceName: string | null;
		sourceFormat: string | null;
		chatPrompt: string;
	}

	interface Props {
		theme: Theme;
		initialMessages: Message[];
		goals: Goal[];
		conversationId: string;
		themeConversations?: ThemeConversation[];
		themeInstruction?: string;
		selectedWorkout?: SelectedWorkout | null;
		tripProfile?: Record<string, unknown> | null;
		tripLists?: import('./TripListsPanel.svelte').ThemeList[];
		themeFiles?: ThemeFile[];
	}

	interface ThemeFile {
		id: string;
		name: string;
		url: string;
		fileType: string | null;
		mimeType: string | null;
		sizeBytes: number | null;
		createdAt: string;
	}

	interface ThemeSignalContract {
		signalType: string;
		ownerDomain: string;
		allowedConsumerDomains: string[];
		description: string | null;
		enabled: boolean;
		config: Record<string, unknown>;
		latest: {
			valueNumber: number | null;
			valueText: string | null;
			valueBool: boolean | null;
			severity: string;
			confidence: string;
			observedAt: string;
			context: Record<string, unknown>;
		} | null;
	}

	let { theme, initialMessages, goals, conversationId, themeConversations = [], themeInstruction = '', selectedWorkout = null, tripProfile = null, tripLists = [], themeFiles: initialThemeFiles = [] }: Props = $props();

	/* ── Subtab-tilstand ────────────────────────────────── */
	type Tab = 'chat' | 'data' | 'mål' | 'flyter' | 'filer' | 'lister';
	const activeDashboardKind = resolveThemeDashboardKind(theme.name);
	const activeDashboard = getThemeDashboardDefinition(theme.name);
	const hasThemeDashboard = activeDashboardKind !== null;
	const isTravel = activeDashboardKind === 'travel';
	const isBooks = activeDashboardKind === 'books';
	const requestedTab = get(page).url.searchParams.get('tab');
	const availableTabs = $derived<Tab[]>(
		activeDashboardKind === 'health'
			? ['chat', 'data', 'mål', 'flyter', 'filer']
			: activeDashboardKind === 'economics'
				? ['chat', 'data', 'mål', 'flyter', 'filer']
				: activeDashboardKind === 'travel'
					? ['chat', 'data', 'lister', 'filer']
					: activeDashboardKind === 'books'
						? ['chat', 'data', 'filer']
						: ['chat', 'data', 'mål', 'filer']
	);
	const requestedPrompt = get(page).url.searchParams.get('prompt') ?? '';
	const hasLinkedWorkout = Boolean(selectedWorkout);
	const isHandoff = get(page).url.searchParams.get('handoff') === '1';
	const validTabs: Tab[] = ['chat', 'data', 'mål', 'flyter', 'filer', 'lister'];
	let tab = $state<Tab>(
		hasLinkedWorkout
			? 'chat'
			: validTabs.includes(requestedTab as Tab)
			? requestedTab as Tab
			: hasThemeDashboard
				? 'data'
				: 'chat'
	);
	let handoffPhase = $state<'intro' | 'content'>('content');
	let healthDashboard = $state<HealthDashboardData | null>(null);
	let economicsDashboard = $state<EconomicsDashboardData | null>(null);
	let travelDashboard = $state<TravelDashboardData | null>(null);
	let dashboardLoading = $state(false);
	let dashboardLoaded = $state(false);
	let dashboardError = $state('');
	let dashboardRequestId = 0;
	let dashboardCachedAt = $state<string | null>(null);

	/* ── Reise-state ────────────────────────────────────── */
	let currentTripProfile = $state(tripProfile as import('./TripDashboard.svelte').TripProfile | null);
	let tripListsState = $state<import('./TripListsPanel.svelte').ThemeList[]>(tripLists);
	let themeFiles = $state<ThemeFile[]>(initialThemeFiles);
	let fileUploading = $state(false);
	let fileUploadError = $state('');
	let signalContracts = $state<ThemeSignalContract[]>([]);
	let signalsLoading = $state(false);
	let signalsLoaded = $state(false);
	let signalsError = $state('');
	let savingSignalType = $state<string | null>(null);
	const enabledSignalCount = $derived(signalContracts.filter((item) => item.enabled).length);

	async function uploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileUploading = true;
		fileUploadError = '';
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/tema/${theme.id}/files`, { method: 'POST', body: fd });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Upload feilet');
			}
			const saved: ThemeFile = await res.json();
			themeFiles = [...themeFiles, saved];
		} catch (err) {
			fileUploadError = err instanceof Error ? err.message : 'Opplasting feilet.';
		} finally {
			fileUploading = false;
			input.value = '';
		}
	}

	async function deleteFile(fileId: string) {
		themeFiles = themeFiles.filter((f) => f.id !== fileId);
		await fetch(`/api/tema/${theme.id}/files/${fileId}`, { method: 'DELETE' });
	}

	function formatBytes(bytes: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatSignalValue(latest: ThemeSignalContract['latest']) {
		if (!latest) return 'Ingen data ennå';
		if (latest.valueText) return latest.valueText;
		if (latest.valueNumber !== null) return Number(latest.valueNumber).toFixed(1);
		if (latest.valueBool !== null) return latest.valueBool ? 'Ja' : 'Nei';
		return 'Ingen data';
	}

	function formatSignalObservedAt(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	async function loadThemeSignals(force = false) {
		if (signalsLoading) return;
		if (signalsLoaded && !force) return;

		signalsLoading = true;
		signalsError = '';
		try {
			const res = await fetch(`/api/tema/${theme.id}/signals`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Kunne ikke laste signaler');
			}
			const data = await res.json() as { contracts: ThemeSignalContract[] };
			signalContracts = data.contracts ?? [];
			signalsLoaded = true;
		} catch (err) {
			signalsError = err instanceof Error ? err.message : 'Kunne ikke laste signaler';
		} finally {
			signalsLoading = false;
		}
	}

	async function setThemeSignalEnabled(signalType: string, enabled: boolean) {
		savingSignalType = signalType;
		signalsError = '';
		const previous = signalContracts;
		signalContracts = signalContracts.map((item) =>
			item.signalType === signalType ? { ...item, enabled } : item
		);

		try {
			const res = await fetch(`/api/tema/${theme.id}/signals`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signalType, enabled })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Kunne ikke oppdatere signal');
			}
		} catch (err) {
			signalContracts = previous;
			signalsError = err instanceof Error ? err.message : 'Kunne ikke oppdatere signal';
		} finally {
			savingSignalType = null;
		}
	}

	const healthDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'health' || !healthDashboard) return null;
		return {
			weekly: healthDashboard.weekly as any,
			monthly: healthDashboard.monthly as any,
			yearly: healthDashboard.yearly as any,
			sources: healthDashboard.sources ?? [],
			recentEvents: healthDashboard.recentEvents ?? [],
			activities: (healthDashboard.activityLayer?.workouts ?? []) as any
		};
	});

	const economicsDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'economics' || !economicsDashboard) return null;
		return {
			accounts: economicsDashboard.accounts,
			totalBalance: economicsDashboard.totalBalance,
			currentMonth: economicsDashboard.currentMonth,
			monthSpending: economicsDashboard.monthSpending,
			recentTransactions: economicsDashboard.recentTransactions,
			paydaySpend: economicsDashboard.paydaySpend
		};
	});

	onMount(() => {
		finishNavMetric('tema');
		void preloadCode('/');

		if (get(page).url.searchParams.get('handoff') !== '1') return;
		handoffPhase = 'intro';
		const timer = setTimeout(() => {
			handoffPhase = 'content';
		}, 950);
		return () => clearTimeout(timer);
	});

	function dashboardKind() {
		return activeDashboardKind;
	}

	function applyCachedDashboard() {
		const kind = dashboardKind();
		if (!kind) return null;

		const cached = getCachedDashboard(theme.id, kind);
		if (!cached) return null;

		dashboardCachedAt = cached.cachedAt;
		dashboardLoaded = true;
		if (kind === 'health') {
			healthDashboard = cached.data as HealthDashboardData;
		} else if (kind === 'economics') {
			economicsDashboard = cached.data as EconomicsDashboardData;
		} else if (kind === 'travel') {
			travelDashboard = cached.data as TravelDashboardData;
		}

		return cached;
	}

	async function ensureDashboardLoaded(force = false) {
		if (!hasThemeDashboard || dashboardLoading) return;

		const kind = dashboardKind();
		if (!kind) return;

		const cached = applyCachedDashboard();
		if (!force && cached) {
			const age = Date.now() - new Date(cached.cachedAt).getTime();
			if (age < 60_000) return;
		}
		if (dashboardLoaded && !force && !cached) return;

		dashboardLoading = true;
		dashboardError = '';
		const requestId = ++dashboardRequestId;

		try {
			const result = await fetchDashboard(theme.id, kind, force);
			if (requestId !== dashboardRequestId) return;

			dashboardCachedAt = result.cachedAt;

			if (kind === 'health') {
				healthDashboard = result.data as HealthDashboardData;
			} else if (kind === 'economics') {
				economicsDashboard = result.data as EconomicsDashboardData;
			} else if (kind === 'travel') {
				travelDashboard = result.data as TravelDashboardData;
			}
			dashboardLoaded = true;
		} catch {
			if (requestId !== dashboardRequestId) return;
			dashboardError = 'Kunne ikke laste dashboarddata.';
			dashboardLoaded = true; // Prevent retry spam
		} finally {
			if (requestId === dashboardRequestId) {
				dashboardLoading = false;
			}
		}
	}

	$effect(() => {
		if (tab === 'data' && hasThemeDashboard) {
			void ensureDashboardLoaded();
		}
	});

	$effect(() => {
		if (tab === 'data') {
			void loadThemeSignals();
		}
	});

	/* ── Chat-tilstand ──────────────────────────────────── */
	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
		imageUrl?: string;
	}

	let chatMessages = $state<ChatMsg[]>(
		initialMessages
			.filter((m) => m.role !== 'system')
			.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }))
	);
	let chatLoading = $state(false);
	let chatError = $state('');
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');
	let archiveRedirect = $state<{ name: string; emoji?: string | null } | null>(null);

	/* ── Samtaler-liste tilstand ────────────────────────── */
	let selectedConvId = $state<string | null>(isHandoff || hasLinkedWorkout || requestedPrompt ? conversationId : null);
	let selectedConvMessages = $state<ChatMsg[]>([]);
	let convLoadingMessages = $state(false);
	let convCreating = $state(false);
	let chatDraft = $state(requestedPrompt || selectedWorkout?.chatPrompt || '');

	/* ── Bilde-opplasting til chat ─────────────────────── */
	let chatImageUploading = $state(false);
	let chatImagePreview = $state<string | null>(null);
	let chatImageUrl = $state<string | null>(null);
	let chatImageInputEl = $state<HTMLInputElement | null>(null);

	async function uploadChatImage(file: File) {
		chatImageUploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
			if (!res.ok) throw new Error('Opplasting feilet');
			const { url } = await res.json();
			chatImageUrl = url;
			chatImagePreview = URL.createObjectURL(file);
		} catch {
			chatError = 'Bilde-opplasting feilet. Prøv igjen.';
			chatImagePreview = null;
			chatImageUrl = null;
		} finally {
			chatImageUploading = false;
		}
	}

	const activeConversationMessages = $derived(
		selectedConvId === conversationId ? chatMessages : selectedConvMessages
	);

	function fmtDay(iso: string): string {
		const d = new Date(iso);
		const today = new Date();
		const isToday =
			d.getDate() === today.getDate() &&
			d.getMonth() === today.getMonth() &&
			d.getFullYear() === today.getFullYear();
		if (isToday)
			return new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' }).format(d);
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(d);
	}

	function formatWorkoutDistance(distanceKm: number | null): string {
		if (distanceKm == null) return 'Ukjent distanse';
		return `${distanceKm.toFixed(2)} km`;
	}

	function formatWorkoutDuration(durationSeconds: number | null): string {
		if (durationSeconds == null) return 'Ukjent varighet';
		const totalMinutes = Math.round(durationSeconds / 60);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return hours > 0 ? `${hours} t ${minutes} min` : `${minutes} min`;
	}

	function formatWorkoutPace(paceSecondsPerKm: number | null): string {
		if (paceSecondsPerKm == null) return 'Ukjent tempo';
		const minutes = Math.floor(paceSecondsPerKm / 60);
		const seconds = Math.round(paceSecondsPerKm % 60)
			.toString()
			.padStart(2, '0');
		return `${minutes}:${seconds} /km`;
	}

	function formatWorkoutTimestamp(timestamp: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(timestamp));
	}

	async function openConversation(convId: string) {
		if (convId === conversationId) {
			selectedConvId = conversationId;
			return;
		}
		convLoadingMessages = true;
		try {
			const res = await fetch(`/api/conversations/${convId}/messages`);
			if (!res.ok) throw new Error('Lasting feilet');
			const data: Array<{ role: string; content: string }> = await res.json();
			selectedConvMessages = data.map((m) => ({
				role: m.role as 'user' | 'assistant',
				text: m.content
			}));
			selectedConvId = convId;
		} catch {
			chatError = 'Kunne ikke laste samtalen.';
		} finally {
			convLoadingMessages = false;
		}
	}

	async function createNewConversation() {
		convCreating = true;
		try {
			const res = await fetch(`/api/tema/${theme.id}/conversations`, { method: 'POST' });
			if (!res.ok) throw new Error('Oppretting feilet');
			const data: { conversationId: string } = await res.json();
			selectedConvMessages = [];
			selectedConvId = data.conversationId;
		} catch {
			chatError = 'Kunne ikke opprette samtale.';
		} finally {
			convCreating = false;
		}
	}

	async function sendMessage(text: string, imageUrl?: string) {
		if (selectedConvId === null) return;
		const isCanon = selectedConvId === conversationId;
		if (isCanon) {
			chatMessages.push({ role: 'user', text: text || '📷', imageUrl: imageUrl || undefined });
		} else {
			selectedConvMessages.push({ role: 'user', text: text || '📷', imageUrl: imageUrl || undefined });
		}
		chatLoading = true;
		chatError = '';
		chatStreamingText = '';
		chatStreamingStatus = 'Starter...';

		try {
			const data = await streamProxyChat({
				message: text || 'Analyser dette bildet og lagr relevante data.',
				imageUrl: imageUrl || undefined,
				conversationId: selectedConvId,
				onStatus: (status) => {
					chatStreamingStatus = status;
				},
				onToken: (token) => {
					chatStreamingStatus = '';
					chatStreamingText += token;
				}
			});

			if (isCanon && data.themeArchived && data.archivedTheme?.id === theme.id) {
				archiveRedirect = {
					name: data.archivedTheme.name,
					emoji: data.archivedTheme.emoji ?? theme.emoji
				};
				setTimeout(() => {
					void goto('/?archivedTheme=1');
				}, 1050);
				return;
			}

			if (isCanon) {
				chatMessages.push({ role: 'assistant', text: data.message });
			} else {
				selectedConvMessages.push({ role: 'assistant', text: data.message });
			}
		} catch (err) {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatStreamingText = '';
			chatStreamingStatus = '';
			chatLoading = false;
		}
	}

	/* ── Data-tab hjelpefunksjoner ──────────────────────── */
	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		completed: '#5fa0a0',
		paused: '#888',
		abandoned: '#e07070',
	};

	function goalPct(goal: Goal): number {
		if (goal.status === 'completed') return 100;
		if (goal.status === 'paused') return 35;
		
		const metadata = goal.metadata as any;
		if (!metadata?.startDate || !metadata?.endDate || !metadata?.targetValue) return 0;
		
		const now = new Date();
		const start = new Date(metadata.startDate);
		const end = new Date(metadata.endDate || metadata.targetDate);
		
		if (now < start) return 0;
		if (now > end) return 100;
		
		const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
		const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
		const expectedProgress = (elapsedDays / totalDays) * 100;
		
		return Math.min(100, Math.max(0, Math.round(expectedProgress)));
	}
	
	function goalDelta(goal: Goal): { value: number; unit: string } | null {
		const metadata = goal.metadata as any;
		if (!metadata?.metricId || !metadata?.targetValue) return null;
		
		if (metadata.metricId === 'running_distance' && healthDashboard?.recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const endDate = metadata.endDate ? new Date(metadata.endDate) : new Date();
			const now = new Date();
			
			const runningEvents = healthDashboard.recentEvents.filter(e => {
				const eventDate = new Date(e.timestamp);
				return e.dataType === 'workout' && 
				       eventDate >= startDate && 
				       eventDate <= now;
			});
			
			let totalKm = 0;
			for (const event of runningEvents) {
				const sportType = typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
				if (sportType && sportType !== 'running') continue;
				
				const distance = typeof event.data.distance === 'number' ? event.data.distance : 
				                 typeof event.data.distanceMeters === 'number' ? event.data.distanceMeters : null;
				
				if (distance !== null) {
					totalKm += distance > 80 ? distance / 1000 : distance;
				}
			}
			
			const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedKm = (elapsedDays / totalDays) * metadata.targetValue;
			
			const delta = totalKm - expectedKm;
			return { value: delta, unit: 'km' };
		}
		
		if (metadata.metricId === 'weight_change' && healthDashboard?.recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const now = new Date();
			
			const weightEvents = healthDashboard.recentEvents
				.filter(e => e.dataType === 'weight' && new Date(e.timestamp) >= startDate)
				.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
			
			if (weightEvents.length === 0) return null;
			
			const latestWeight = typeof weightEvents[0].data.weight === 'number' ? weightEvents[0].data.weight : null;
			const startWeight = metadata.startValue;
			
			if (latestWeight === null || startWeight === null) return null;
			
			const actualChange = latestWeight - startWeight;
			const targetChange = metadata.targetValue;
			
			const totalDays = metadata.endDate ? 
				(new Date(metadata.endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24) : 90;
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedChange = (elapsedDays / totalDays) * targetChange;
			
			const delta = actualChange - expectedChange;
			return { value: delta, unit: 'kg' };
		}
		
		return null;
	}

	/* ── Filer-tab: instruksjonsfil ─────────────────────── */
	const instructionFileName = 'instrukser';
	let instructionDraft = $state(themeInstruction ?? '');
	let instructionSaving = $state(false);
	let instructionSaved = $state(false);
	let instructionError = $state('');

	function fileIcon(type: string | null): string {
		if (type === 'image') return '🖼';
		if (type === 'pdf') return '📋';
		return '📄';
	}

	/* ── Mål-tab: målredigering ─────────────────────────── */
	let editingGoalId = $state<string | null>(null);
	let editGoalTitle = $state('');
	let editGoalDesc = $state('');
	let editGoalTargetDate = $state('');
	let editGoalStartDate = $state('');
	let editGoalEndDate = $state('');
	let editGoalTargetValue = $state('');
	let editGoalStartValue = $state('');
	let editGoalMetricId = $state('');
	let editGoalSaving = $state(false);
	let editGoalError = $state('');

	function startEditGoal(goal: Goal) {
		editingGoalId = goal.id;
		editGoalTitle = goal.title;
		editGoalDesc = goal.description ?? '';
		
		const metadata = goal.metadata as any;
		editGoalMetricId = metadata?.metricId ?? '';
		editGoalStartDate = metadata?.startDate ?? '';
		editGoalEndDate = metadata?.endDate ?? '';
		editGoalTargetValue = metadata?.targetValue?.toString() ?? '';
		editGoalStartValue = metadata?.startValue?.toString() ?? '';
		
		if (metadata?.targetDate) {
			editGoalTargetDate = metadata.targetDate;
		} else if (metadata?.endDate) {
			editGoalTargetDate = metadata.endDate;
		} else {
			editGoalTargetDate = '';
		}
	}

	function cancelEditGoal() {
		editingGoalId = null;
		editGoalTitle = '';
		editGoalDesc = '';
		editGoalTargetDate = '';
		editGoalStartDate = '';
		editGoalEndDate = '';
		editGoalTargetValue = '';
		editGoalStartValue = '';
		editGoalMetricId = '';
		editGoalError = '';
	}

	async function saveEditedGoal() {
		if (!editingGoalId) return;
		
		editGoalSaving = true;
		editGoalError = '';
		
		try {
			const updateData: any = {
				title: editGoalTitle,
				description: editGoalDesc || null,
				targetDate: editGoalTargetDate || null
			};
			
			// Oppdater metadata basert på måltype
			if (editGoalMetricId === 'running_distance') {
				const targetKm = Number.parseFloat(String(editGoalTargetValue).replace(',', '.'));
				if (editGoalStartDate && editGoalEndDate && Number.isFinite(targetKm)) {
					updateData.metadata = {
						metricId: 'running_distance',
						goalKind: 'level',
						goalWindow: 'custom',
						targetValue: targetKm,
						unit: 'km',
						startDate: editGoalStartDate,
						endDate: editGoalEndDate
					};
					updateData.targetDate = editGoalEndDate;
				}
			} else if (editGoalMetricId === 'weight_change') {
				const startVal = Number.parseFloat(String(editGoalStartValue).replace(',', '.'));
				const targetVal = Number.parseFloat(String(editGoalTargetValue).replace(',', '.'));
				if (editGoalStartDate && editGoalEndDate && Number.isFinite(startVal) && Number.isFinite(targetVal)) {
					const change = targetVal - startVal;
					updateData.metadata = {
						metricId: 'weight_change',
						goalKind: 'trajectory',
						goalWindow: 'custom',
						targetValue: change,
						unit: 'kg',
						startDate: editGoalStartDate,
						endDate: editGoalEndDate,
						startValue: startVal
					};
					updateData.targetDate = editGoalEndDate;
				}
			}
			
			const res = await fetch(`/api/goals/${editingGoalId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});
			
			if (!res.ok) throw new Error('save_failed');
			
			window.location.reload();
		} catch {
			editGoalError = 'Klarte ikke lagre endringer.';
		} finally {
			editGoalSaving = false;
		}
	}

	async function archiveGoal(goalId: string) {
		if (!confirm('Er du sikker på at du vil arkivere dette målet?')) return;
		
		try {
			const res = await fetch(`/api/goals/${goalId}`, {
				method: 'DELETE'
			});
			
			if (!res.ok) throw new Error('delete_failed');
			
			window.location.reload();
		} catch {
			alert('Klarte ikke arkivere målet. Prøv igjen.');
		}
	}

	/* ── Mål-tab: fleksible helse-målkontroller ─────────── */
	let newHealthGoalType = $state<'running' | 'weight' | null>(null);
	let runningStartDate = $state('');
	let runningEndDate = $state('');
	let runningTargetKm = $state('');
	let weightStartDate = $state('');
	let weightStartValue = $state('');
	let weightTargetDate = $state('');
	let weightTargetValue = $state('');
	let healthGoalSaving = $state(false);
	let healthGoalError = $state('');

	function formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getLatestWeight(): string {
		if (!healthDashboard?.recentEvents) return '';
		
		const weightEvents = healthDashboard.recentEvents
			.filter(e => e.dataType === 'weight')
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		
		if (weightEvents.length === 0) return '';
		
		const latestWeight = weightEvents[0].data.weight;
		if (typeof latestWeight === 'number') {
			return String(latestWeight.toFixed(1));
		}
		
		return '';
	}

	function initWeightGoalDefaults() {
		const today = new Date();
		weightStartDate = formatDate(today);
		weightStartValue = getLatestWeight();
		
		const target = new Date();
		target.setDate(target.getDate() + 90);
		weightTargetDate = formatDate(target);
	}

	function initRunningGoalDefaults() {
		const today = new Date();
		runningStartDate = formatDate(today);
		
		const target = new Date();
		target.setDate(target.getDate() + 90);
		runningEndDate = formatDate(target);
	}

	function cancelHealthGoalCreation() {
		newHealthGoalType = null;
		healthGoalError = '';
		runningStartDate = '';
		runningEndDate = '';
		runningTargetKm = '';
		weightStartDate = '';
		weightStartValue = '';
		weightTargetDate = '';
		weightTargetValue = '';
	}

	async function saveNewHealthGoal() {
		if (!newHealthGoalType) return;
		
		healthGoalSaving = true;
		healthGoalError = '';
		
		try {
			if (newHealthGoalType === 'running') {
				const targetKm = Number.parseFloat(String(runningTargetKm).replace(',', '.'));
				if (!runningStartDate || !runningEndDate || !Number.isFinite(targetKm)) {
					healthGoalError = 'Fyll ut alle feltene for løpemål.';
					healthGoalSaving = false;
					return;
				}
				
				const res = await fetch('/api/goals', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						categoryName: 'Helse',
						themeId: theme.id,
						title: `Løpe ${targetKm} km`,
						description: `Fra ${runningStartDate} til ${runningEndDate}`,
						targetDate: runningEndDate,
						metricId: 'running_distance',
						goalKind: 'level',
						goalWindow: 'custom',
						targetValue: targetKm,
						unit: 'km',
						startDate: runningStartDate,
						endDate: runningEndDate
					})
				});
				
				if (!res.ok) {
					const errorData = await res.text();
					console.error('Goal creation failed:', res.status, errorData);
					throw new Error(`HTTP ${res.status}: ${errorData}`);
				}
			} else if (newHealthGoalType === 'weight') {
				const startVal = Number.parseFloat(String(weightStartValue).replace(',', '.'));
				const targetVal = Number.parseFloat(String(weightTargetValue).replace(',', '.'));
				
				if (!weightStartDate || !weightTargetDate || !Number.isFinite(startVal) || !Number.isFinite(targetVal)) {
					healthGoalError = 'Fyll ut alle feltene for vektmål.';
					healthGoalSaving = false;
					return;
				}
				
				const change = targetVal - startVal;
				
				const res = await fetch('/api/goals', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						categoryName: 'Helse',
						themeId: theme.id,
						title: `${change > 0 ? 'Øke' : 'Redusere'} vekt til ${targetVal} kg`,
						description: `Fra ${startVal} kg (${weightStartDate}) til ${targetVal} kg (${weightTargetDate})`,
						targetDate: weightTargetDate,
						metricId: 'weight_change',
						goalKind: 'trajectory',
						goalWindow: 'custom',
						targetValue: change,
						unit: 'kg',
						startDate: weightStartDate,
						startValue: startVal
					})
				});
				
				if (!res.ok) {
					const errorData = await res.text();
					console.error('Goal creation failed:', res.status, errorData);
					throw new Error(`HTTP ${res.status}: ${errorData}`);
				}
			}
			
			newHealthGoalType = null;
			runningStartDate = '';
			runningEndDate = '';
			runningTargetKm = '';
			weightStartDate = '';
			weightStartValue = '';
			weightTargetDate = '';
			weightTargetValue = '';
			
			window.location.reload();
		} catch (err) {
			console.error('Health goal creation error:', err);
			healthGoalError = 'Klarte ikke opprette mål. Prøv igjen.';
		} finally {
			healthGoalSaving = false;
		}
	}

	/* ── Flyter-tab: flow discovery ─────────── */
	let selectedFlow = $state<Flow | null>(null);
	const availableFlows = $derived(getFlowsByTheme(theme.name, theme.parentTheme));

	async function handleFlowComplete(flowId: string, data: Record<string, any>) {
		// Handle flow completion based on flow ID
		if (flowId === 'health_weight_onboarding') {
			// Save weight onboarding data
			const startWeight = typeof data.startWeight === 'number' ? data.startWeight : null;
			const targetWeight = typeof data.targetWeight === 'number' ? data.targetWeight : null;
			const targetChange = startWeight && targetWeight ? targetWeight - startWeight : undefined;

			try {
				const response = await fetch('/api/health/weight-onboarding', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						historyText: data.historyText || '',
						startDate: data.startDate || '',
						endDate: data.endDate || '',
						startWeight,
						targetWeight,
						targetChange
					})
				});

				const payload = await response.json();
				if (!response.ok || payload.success === false) {
					throw new Error(payload?.message || 'Kunne ikke lagre onboarding');
				}
				
				// Refresh dashboard if we're on health theme
				if (activeDashboardKind === 'health') {
					void ensureDashboardLoaded(true);
				}
			} catch (error) {
				console.error('Flow completion error:', error);
			}
		} else if (flowId === 'economics_category_budget') {
			// Save category budget goal
			try {
				const category = data.category as string;
				const monthlyBudget = Number(data.monthlyBudget);
				
				if (!category || !Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
					throw new Error('Invalid category or budget value');
				}

				// Map category to metric ID (e.g., 'dagligvarer' -> 'grocery_spend')
				const metricId = category === 'dagligvarer' ? 'grocery_spend' : `${category}_spend`;
				const categoryLabels: Record<string, string> = {
					dagligvarer: 'Dagligvarer',
					kafe_og_restaurant: 'Kafe og restaurant',
					bil_og_transport: 'Transport og bil',
					helse_og_velvaere: 'Helse og velvære',
					medier_og_underholdning: 'Medier og underholdning',
					hobby_og_fritid: 'Hobby og fritid',
					hjem_og_hage: 'Hjem og hage',
					klaer_og_utstyr: 'Klær og utstyr',
					barn: 'Barn',
					reise: 'Reise'
				};

				const response = await fetch(`/api/goal-tracks/${metricId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						tracks: [
							{
								id: `${category}-month`,
								metricId,
								label: `${categoryLabels[category] || category} per måned`,
								kind: 'level',
								window: 'month',
								targetValue: monthlyBudget,
								unit: 'kr',
								priority: 100
							}
						]
					})
				});

				if (!response.ok) {
					throw new Error('Failed to save category budget');
				}

				// Refresh economics dashboard
				if (activeDashboardKind === 'economics') {
					void ensureDashboardLoaded(true);
				}
			} catch (error) {
				console.error('Flow completion error:', error);
			}
		}
		// Add handling for other flow types here as needed
	}

	function startFlow(flow: Flow) {
		selectedFlow = flow;
	}

	function closeFlow() {
		selectedFlow = null;
	}

	/* ── Navigasjon: klikk + swipe ─────────────────────── */
	let touchStartX = 0;
	let touchStartY = 0;
	let touchActive = false;
	let swipeUsed = false;
	let pinchStartDistance = 0;
	let pinchActive = false;

	function goHome() {
		startNavMetric('tema', 'home');
		void goto('/');
	}

	function touchDistance(touches: TouchList): number {
		if (touches.length < 2) return 0;
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.hypot(dx, dy);
	}

	function onTouchStart(event: TouchEvent) {
		if (event.touches.length === 2) {
			pinchStartDistance = touchDistance(event.touches);
			pinchActive = pinchStartDistance > 0;
			touchActive = false;
			return;
		}

		if (event.touches.length !== 1) {
			touchActive = false;
			return;
		}
		const touch = event.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchActive = true;
		swipeUsed = false;
	}

	function onTouchMove(event: TouchEvent) {
		if (pinchActive && event.touches.length === 2) {
			const currentDistance = touchDistance(event.touches);
			// Pinch in (fingre nærmere hverandre) defokuserer temaet.
			if (pinchStartDistance - currentDistance > 44) {
				pinchActive = false;
				goHome();
			}
			return;
		}

		if (!touchActive || swipeUsed || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = Math.abs(touch.clientY - touchStartY);

		// Edge-swipe: start nær venstre kant og dra tydelig mot høyre.
		if (touchStartX <= 38 && deltaX > 92 && deltaY < 70) {
			swipeUsed = true;
			touchActive = false;
			goHome();
		}
	}

	function onTouchEnd() {
		touchActive = false;
		pinchActive = false;
	}

	$effect(() => {
		instructionDraft = themeInstruction ?? '';
	});

	async function saveInstruction() {
		instructionSaving = true;
		instructionSaved = false;
		instructionError = '';

		try {
			const res = await fetch(`/api/tema/${theme.id}/instruction`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: instructionDraft })
			});

			if (!res.ok) throw new Error('Lagring feilet');

			instructionSaved = true;
			setTimeout(() => {
				instructionSaved = false;
			}, 1400);
		} catch {
			instructionError = 'Lagring feilet. Prøv igjen.';
		} finally {
			instructionSaving = false;
		}
	}
</script>

<div class="theme-page" style={getThemeHueStyle(theme.name)} ontouchstart={onTouchStart} ontouchmove={onTouchMove} ontouchend={onTouchEnd}>
	{#if archiveRedirect}
		<section class="tp-archived" aria-live="polite">
			<div class="tp-archived-chip">
				<span class="tp-archived-icon">{archiveRedirect.emoji ?? '◎'}</span>
				<span>Tema arkivert</span>
			</div>
			<h1 class="tp-archived-title">{archiveRedirect.name}</h1>
			<p class="tp-archived-copy">Sender deg tilbake til hjem…</p>
		</section>
	{:else}
	{#if handoffPhase === 'intro'}
		<section class="tp-launch" aria-live="polite">
			<div class="tp-launch-chip">
				<span class="tp-launch-icon">{theme.emoji ?? '◎'}</span>
				<span>Nytt tema</span>
			</div>
			<h1 class="tp-launch-title">{theme.name}</h1>
			<p class="tp-launch-copy">Kobler deg inn i Samtaler, Mål og Filer…</p>
		</section>
	{:else}
		<!-- ── Topptekst ── -->
		<header class="tp-header tp-enter">
			<ScreenTitle
				title={theme.name}
				subtitle={theme.description ?? ''}
				emoji={theme.emoji ?? '🎯'}
				onpress={goHome}
				ariaLabel="Gå til forsiden"
			/>
		</header>

		<!-- ── Tabs ── -->
		<div class="tp-tabs tp-enter" role="tablist" aria-label="Tema-seksjoner">
			{#each availableTabs as t}
				<button
					class="tp-tab"
					class:active={tab === t}
					role="tab"
					aria-selected={tab === t}
					onclick={() => (tab = t)}
				>
					{#if t === 'chat'}💬 Samtaler
				{:else if t === 'data'}{activeDashboard ? `${activeDashboard.icon} ${activeDashboard.label}` : '📊 Data'}
					{:else if t === 'mål'}🎯 Mål
					{:else if t === 'flyter'}🧭 Flyter
					{:else if t === 'lister'}📋 Lister
					{:else}📁 Filer{/if}
				</button>
			{/each}
		</div>

		<!-- ── Tab-innhold ── -->
		<div class="tp-body tp-enter">
		<!-- CHAT -->
		{#if tab === 'chat'}
			{#if selectedConvId === null}
				<!-- Samtale-liste -->
				<div class="conv-list-panel">
					<div class="conv-list-actions">
						<button
							class="conv-new-btn"
							onclick={createNewConversation}
							disabled={convCreating}
						>
							{convCreating ? '…' : '+ Ny samtale'}
						</button>
					</div>

					{#if convLoadingMessages}
						<p class="conv-list-loading">Laster…</p>
					{:else if themeConversations.length === 0}
						<div class="conv-list-empty">
							<p>Ingen samtaler ennå.</p>
						</div>
					{:else}
						<div class="conv-list">
							{#each themeConversations as conv}
								<button
									class="conv-item"
									onclick={() => openConversation(conv.id)}
								>
									<div class="conv-item-main">
										<span class="conv-item-title">{conv.title}</span>
										<span class="conv-item-date">{fmtDay(conv.updatedAt)}</span>
									</div>
									{#if conv.preview}
										<p class="conv-item-preview">{conv.preview}</p>
									{/if}
								</button>
							{/each}
						</div>
					{/if}

					{#if chatError}
						<p class="chat-error" style="padding: 0 16px;">{chatError}</p>
					{/if}
				</div>
			{:else}
				<!-- Åpen samtale -->
				<div class="chat-panel">
					<div class="conv-back-bar">
						<button
							class="conv-back-btn"
							onclick={() => { selectedConvId = null; chatError = ''; }}
							aria-label="Tilbake til samtaler"
						>
							<Icon name="back" size={16} /> Samtaler
						</button>
					</div>

					{#if selectedWorkout}
						<section class="chat-workout-context" aria-label="Valgt treningsøkt">
							<div class="chat-workout-head">
								<div>
									<p class="chat-workout-kicker">Valgt økt</p>
									<h3>{selectedWorkout.title}</h3>
									<p>{formatWorkoutTimestamp(selectedWorkout.timestamp)}</p>
								</div>
								<button class="chat-workout-data-btn" onclick={() => (tab = 'data')}>Se data</button>
							</div>
							<div class="chat-workout-metrics">
								<span>{formatWorkoutDistance(selectedWorkout.distanceKm)}</span>
								<span>{formatWorkoutDuration(selectedWorkout.durationSeconds)}</span>
								<span>{formatWorkoutPace(selectedWorkout.paceSecondsPerKm)}</span>
								{#if selectedWorkout.avgHeartRate != null}
									<span>Puls {Math.round(selectedWorkout.avgHeartRate)}</span>
								{/if}
							</div>
							{#if selectedWorkout.sourceName}
								<p class="chat-workout-source">Kilde: {selectedWorkout.sourceName}</p>
							{/if}
						</section>
					{/if}

					<div class="chat-messages" aria-live="polite" aria-label="Samtalehistorikk">
						{#if activeConversationMessages.length === 0}
							<p class="chat-empty">Ingen meldinger ennå — start samtalen nedenfor.</p>
						{/if}

						{#each activeConversationMessages as msg}
							{#if msg.role === 'user'}
								{#if msg.imageUrl}
									<img class="bubble-img" src={msg.imageUrl} alt="Bilde" loading="lazy" />
								{/if}
								<div class="bubble bubble-user">{msg.text}</div>
							{:else}
								<TriageCard text={msg.text} />
							{/if}
						{/each}

						{#if chatLoading}
							{#if chatStreamingText}
								<TriageCard text={chatStreamingText} streaming={true} />
							{:else}
								<TriageCard loading={true} status={chatStreamingStatus} />
							{/if}
						{/if}

						{#if chatError}
							<p class="chat-error">{chatError}</p>
						{/if}
					</div>

					<div class="chat-input-wrap">
						{#if chatImagePreview}
							<div class="chat-image-preview">
								<img src={chatImagePreview} alt="Forhåndsvisning" class="chat-image-thumb" />
								<button class="chat-image-remove" onclick={() => { chatImagePreview = null; chatImageUrl = null; }} aria-label="Fjern bilde">×</button>
							</div>
						{/if}
						<ChatInput
							placeholder="Spør om {theme.name.toLowerCase()}…"
							disabled={chatLoading || chatImageUploading}
							initialValue={chatDraft}
							onsubmit={(message) => {
								chatDraft = '';
								const img = chatImageUrl;
								chatImageUrl = null;
								chatImagePreview = null;
								return sendMessage(message, img ?? undefined);
							}}
							onAttachment={(kind) => {
								if (kind === 'camera' || kind === 'file') chatImageInputEl?.click();
							}}
						/>
						<input
							bind:this={chatImageInputEl}
							type="file"
							accept="image/*"
							class="files-upload-input"
							onchange={(e) => {
								const f = (e.currentTarget as HTMLInputElement).files?.[0];
								if (f) void uploadChatImage(f);
								(e.currentTarget as HTMLInputElement).value = '';
							}}
						/>
					</div>
				</div>
			{/if}

		<!-- DATA -->
		{:else if tab === 'data'}
			{#if isBooks}
				<BookDashboard themeId={theme.id} />
			{:else}
			<div class="data-panel">
				{#if isTravel}
					<TripDashboard
						themeId={theme.id}
						themeEmoji={theme.emoji}
						bind:tripProfile={currentTripProfile}
					/>
				{:else}
				{#if hasThemeDashboard && dashboardLoading && !dashboardLoaded}
					<div class="data-empty data-empty-tight">
						<p>Laster dashboard…</p>
					</div>
				{/if}

				{#if hasThemeDashboard && dashboardError && !dashboardLoaded}
					<div class="data-empty data-empty-tight">
						<p>{dashboardError}</p>
						<button class="data-new-btn" onclick={() => void ensureDashboardLoaded(true)}>
							Prøv igjen
						</button>
					</div>
				{/if}

				{#if healthDashboardProps}
					<HealthDashboard
						{...healthDashboardProps}
						embedded={true}
					/>
				{/if}

				{#if economicsDashboardProps}
					<EconomicsDashboard
						{...economicsDashboardProps}
						embedded={true}
					/>
				{/if}

				{#if hasThemeDashboard && dashboardLoading && dashboardLoaded}
					<p class="data-refreshing">Oppdaterer dashboard…</p>
				{/if}

				{#if hasThemeDashboard && dashboardCachedAt}
					<p class="data-refreshing">Sist lagret: {new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(dashboardCachedAt))}</p>
				{/if}

				{#if !hasThemeDashboard}
				{#if goals.length === 0}
					<div class="data-empty" class:data-empty-tight={false}>
						<p>Ingen aktive mål i dette temaet ennå.</p>
						<button
							class="data-new-btn"
							onclick={() => {
								tab = 'chat';
							}}
						>
							+ Si til AI at du vil sette et mål
						</button>
					</div>
				{:else}
					<div class="goals-grid">
						{#each goals as goal}
							{@const pct = goalPct(goal)}
							{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
							{@const delta = goalDelta(goal)}
							<div class="goal-card">
								<div class="goal-ring">
									<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
										{#snippet children()}
											{#if delta}
												<text
													x="40"
													y="40"
													text-anchor="middle"
													fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
													font-size="14"
													font-weight="700"
												>{delta.value >= 0 ? '+' : ''}{delta.value.toFixed(1)}</text>
												<text
													x="40"
													y="52"
													text-anchor="middle"
													fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
													font-size="9"
													font-weight="600"
												>{delta.unit}</text>
											{:else}
												<text
													x="40"
													y="44"
													text-anchor="middle"
													fill={color}
													font-size="12"
													font-weight="700"
												>{pct}%</text>
											{/if}
										{/snippet}
									</GoalRing>
								</div>
								<div class="goal-info">
									<span class="goal-title">{goal.title}</span>
									{#if goal.description}
										<span class="goal-desc">{goal.description}</span>
									{/if}
									<span
										class="goal-status"
										style="color:{color}"
									>{goal.status}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
				{/if}
				{/if}

				<details class="signal-collapsed-wrap">
					<summary class="signal-collapsed-summary">
						<span>Signalinput</span>
						<span class="signal-collapsed-count">{enabledSignalCount} aktiv{enabledSignalCount === 1 ? '' : 'e'}</span>
					</summary>
					<div class="signal-collapsed-body">
						<p class="signal-panel-copy">Velg hvilke kontrakter dette temaet skal bruke som datainput.</p>

						{#if signalsLoading && !signalsLoaded}
							<p class="signal-state">Laster signaler…</p>
						{:else if signalsError}
							<div class="signal-state signal-state-error">
								<span>{signalsError}</span>
								<button class="signal-retry-btn" onclick={() => void loadThemeSignals(true)}>Prøv igjen</button>
							</div>
						{:else if signalContracts.length === 0}
							<p class="signal-state">Ingen signal-kontrakter tilgjengelig ennå.</p>
						{:else}
							<div class="signal-list">
								{#each signalContracts as signal}
									<label class="signal-item" for={`signal-${signal.signalType}`}>
										<div class="signal-item-main">
											<div class="signal-item-title-row">
												<strong>{signal.signalType}</strong>
												<span class="signal-owner">{signal.ownerDomain}</span>
											</div>
											{#if signal.description}
												<p class="signal-item-desc">{signal.description}</p>
											{/if}
											{#if signal.latest}
												<p class="signal-item-latest">
													Sist: {formatSignalValue(signal.latest)} · {formatSignalObservedAt(signal.latest.observedAt)}
												</p>
											{/if}
										</div>
										<input
											id={`signal-${signal.signalType}`}
											type="checkbox"
											checked={signal.enabled}
											disabled={savingSignalType === signal.signalType}
											onchange={(event) => setThemeSignalEnabled(signal.signalType, (event.currentTarget as HTMLInputElement).checked)}
										/>
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</details>
			</div>
			{/if}

		<!-- LISTER (reise) -->
		{:else if tab === 'lister'}
			<TripListsPanel
				themeId={theme.id}
				bind:lists={tripListsState}
			/>

		<!-- MÅL -->
		{:else if tab === 'mål'}
			<div class="goals-panel">
				<!-- Eksisterende mål -->
				{#if goals.length > 0}
					<div class="goals-section">
						<h2 class="goals-section-title">Aktive mål</h2>
						<div class="goals-grid">
							{#each goals.filter(g => g.status === 'active') as goal}
								{@const pct = goalPct(goal)}
								{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
								{#if editingGoalId === goal.id}
									<div class="goal-card goal-card-editing">
										<div class="goal-edit-form">
											<label class="goal-edit-label">
												Tittel
												<input
													class="goal-edit-input"
													type="text"
													bind:value={editGoalTitle}
													placeholder="Måltittel"
												/>
											</label>
											<label class="goal-edit-label">
												Beskrivelse
												<textarea
													class="goal-edit-textarea"
													bind:value={editGoalDesc}
													placeholder="Detaljer om målet"
													rows="3"
												></textarea>
											</label>
											
											{#if editGoalMetricId === 'running_distance'}
												<label class="goal-edit-label">
													Startdato
													<input
														class="goal-edit-input"
														type="date"
														bind:value={editGoalStartDate}
													/>
												</label>
												<label class="goal-edit-label">
													Sluttdato
													<input
														class="goal-edit-input"
														type="date"
														bind:value={editGoalEndDate}
													/>
												</label>
												<label class="goal-edit-label">
													Mål (km)
													<input
														class="goal-edit-input"
														type="number"
														step="0.1"
														bind:value={editGoalTargetValue}
														placeholder="150"
													/>
												</label>
											{:else if editGoalMetricId === 'weight_change'}
												<label class="goal-edit-label">
													Startdato
													<input
														class="goal-edit-input"
														type="date"
														bind:value={editGoalStartDate}
													/>
												</label>
												<label class="goal-edit-label">
													Startvekt (kg)
													<input
														class="goal-edit-input"
														type="number"
														step="0.1"
														bind:value={editGoalStartValue}
														placeholder="85"
													/>
												</label>
												<label class="goal-edit-label">
													Måldato
													<input
														class="goal-edit-input"
														type="date"
														bind:value={editGoalEndDate}
													/>
												</label>
												<label class="goal-edit-label">
													Målvekt (kg)
													<input
														class="goal-edit-input"
														type="number"
														step="0.1"
														bind:value={editGoalTargetValue}
														placeholder="78"
													/>
												</label>
											{:else}
												<label class="goal-edit-label">
													Måldag
													<input
														class="goal-edit-input"
														type="date"
														bind:value={editGoalTargetDate}
													/>
												</label>
											{/if}
											
											{#if editGoalError}
												<p class="goal-edit-error">{editGoalError}</p>
											{/if}
											<div class="goal-edit-actions">
												<button
													class="goal-edit-save"
													type="button"
													onclick={saveEditedGoal}
													disabled={editGoalSaving}
												>
													{editGoalSaving ? 'Lagrer…' : 'Lagre'}
												</button>
												<button
													class="goal-edit-cancel"
													type="button"
													onclick={cancelEditGoal}
													disabled={editGoalSaving}
												>
													Avbryt
												</button>
											</div>
										</div>
									</div>
								{:else}
									<div class="goal-card">
										<div class="goal-ring">
											<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
												{#snippet children()}
													<text
														x="40"
														y="44"
														text-anchor="middle"
														fill={color}
														font-size="12"
														font-weight="700"
													>{pct}%</text>
												{/snippet}
											</GoalRing>
										</div>
										<div class="goal-info">
											<span class="goal-title">{goal.title}</span>
											{#if goal.description}
												<span class="goal-desc">{goal.description}</span>
											{/if}
											<span
												class="goal-status"
												style="color:{color}"
											>{goal.status}</span>
										</div>
										<div class="goal-actions">
											<button
												class="goal-action-btn goal-edit-btn"
												type="button"
												onclick={() => startEditGoal(goal)}
												aria-label="Rediger mål"
											>
												✎
											</button>
											<button
												class="goal-action-btn goal-delete-btn"
												type="button"
												onclick={() => archiveGoal(goal.id)}
												aria-label="Arkiver mål"
											>
												🗑
											</button>
										</div>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Helse-spesifikke målkontroller -->
				{#if activeDashboardKind === 'health'}
					<div class="goals-create-section">
						<h2 class="goals-section-title">Opprett helsemål</h2>
						<p class="goals-section-copy">Sett løpemål og vektmål med fleksible tidsrammer.</p>
						
						{#if !newHealthGoalType}
							<div class="goal-type-selector">
								<button
									class="goal-type-btn"
									type="button"
									onclick={() => { newHealthGoalType = 'running'; initRunningGoalDefaults(); }}
								>
									+ Løpemål
								</button>
								<button
									class="goal-type-btn"
									type="button"
									onclick={() => { newHealthGoalType = 'weight'; initWeightGoalDefaults(); }}
								>
									+ Vektmål
								</button>
							</div>
						{:else if newHealthGoalType === 'running'}
							<div class="goal-control">
								<div class="goal-control-label">Løpemål</div>
								<div class="goal-control-row">
									<label class="goal-control-field">
										Fra dato
										<input
											class="goal-control-input"
											type="date"
											bind:value={runningStartDate}
										/>
									</label>
									<label class="goal-control-field">
										Til dato
										<input
											class="goal-control-input"
											type="date"
											bind:value={runningEndDate}
										/>
									</label>
								</div>
								<label class="goal-control-field">
									Mål (km)
									<input
										class="goal-control-input"
										type="number"
										step="0.5"
										min="0"
										bind:value={runningTargetKm}
										placeholder="100"
									/>
								</label>
								{#if healthGoalError}
									<p class="goal-control-error">{healthGoalError}</p>
								{/if}
								<div class="goal-control-actions">
									<button
										class="goal-control-save"
										type="button"
										onclick={saveNewHealthGoal}
										disabled={healthGoalSaving}
									>
										{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
									</button>
									<button
										class="goal-control-cancel"
										type="button"
										onclick={cancelHealthGoalCreation}
										disabled={healthGoalSaving}
									>
										Avbryt
									</button>
								</div>
							</div>
						{:else if newHealthGoalType === 'weight'}
							<div class="goal-control">
								<div class="goal-control-label">Vektmål</div>
								<div class="goal-control-row">
									<label class="goal-control-field">
										Startdato
										<input
											class="goal-control-input"
											type="date"
											bind:value={weightStartDate}
										/>
									</label>
									<label class="goal-control-field">
										Startvekt (kg)
										<input
											class="goal-control-input"
											type="number"
											step="0.1"
											min="0"
											bind:value={weightStartValue}
											placeholder="80"
										/>
									</label>
								</div>
								<div class="goal-control-row">
									<label class="goal-control-field">
										Måldato
										<input
											class="goal-control-input"
											type="date"
											bind:value={weightTargetDate}
										/>
									</label>
									<label class="goal-control-field">
										Målvekt (kg)
										<input
											class="goal-control-input"
											type="number"
											step="0.1"
											min="0"
											bind:value={weightTargetValue}
											placeholder="75"
										/>
									</label>
								</div>
								{#if healthGoalError}
									<p class="goal-control-error">{healthGoalError}</p>
								{/if}
								<div class="goal-control-actions">
									<button
										class="goal-control-save"
										type="button"
										onclick={saveNewHealthGoal}
										disabled={healthGoalSaving}
									>
										{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
									</button>
									<button
										class="goal-control-cancel"
										type="button"
										onclick={cancelHealthGoalCreation}
										disabled={healthGoalSaving}
									>
										Avbryt
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				{#if goals.length === 0 && activeDashboardKind !== 'health'}
					<div class="goals-empty">
						<p>Ingen aktive mål i dette temaet ennå.</p>
						<button
							class="goals-new-btn"
							onclick={() => { tab = 'chat'; }}
						>
							+ Si til AI at du vil sette et mål
						</button>
					</div>
				{/if}
			</div>

		<!-- FLYTER -->
		{:else if tab === 'flyter'}
			<div class="flows-panel">
				{#if availableFlows.length > 0}
					<div class="flows-section">
						<h2 class="flows-section-title">Tilgjengelige flyter</h2>
						<p class="flows-section-copy">Strukturerte flyter som hjelper deg i gang med {theme.name}.</p>
						<div class="flows-grid">
							{#each availableFlows as flow}
								<FlowCard {flow} onstart={() => startFlow(flow)} />
							{/each}
						</div>
					</div>
				{:else}
					<div class="flows-empty">
						<p class="flows-empty-message">Ingen flyter tilgjengelig for dette temaet ennå.</p>
					</div>
				{/if}
			</div>

		<!-- FILER -->
		{:else}
			<div class="files-panel">
				<div class="files-header">
					<span class="files-count">{1 + themeFiles.length} {1 + themeFiles.length === 1 ? 'fil' : 'filer'}</span>
					<label class="files-upload-btn" aria-label="Last opp fil">
						{fileUploading ? 'Laster opp…' : '+ Legg til fil'}
						<input
							type="file"
							accept="image/*,application/pdf,.txt,.md,.csv"
							disabled={fileUploading}
							class="files-upload-input"
							onchange={uploadFile}
						/>
					</label>
				</div>

				{#if fileUploadError}
					<p class="file-upload-error">{fileUploadError}</p>
				{/if}

				<!-- Instruksjonsfil -->
				<div class="instruction-file">
					<div class="instruction-file-head">
						<span class="instruction-file-icon">📄</span>
						<span class="instruction-file-name">{instructionFileName}</span>
						<button class="files-save-btn" onclick={saveInstruction} disabled={instructionSaving} aria-label="Lagre instruksfil">
							{instructionSaving ? 'Lagrer…' : 'Lagre'}
						</button>
					</div>

					<textarea
						class="instruction-editor"
						bind:value={instructionDraft}
						rows="14"
						placeholder="# Instrukser

Skriv hvordan du vil jobbe med dette temaet.

Eksempel:
- Hvor ser jeg meg om fem år?
- Hva er viktigst nå?
- Hvilke mål må justeres?"
					></textarea>

					<div class="instruction-foot">
						{#if instructionError}
							<span class="instruction-error">{instructionError}</span>
						{:else if instructionSaved}
							<span class="instruction-saved">Lagret</span>
						{:else if !instructionDraft.trim()}
							<span class="instruction-empty">Tom fil klar for utfylling</span>
						{:else}
							<span class="instruction-empty">Redigerbar instruksfil for temaet</span>
						{/if}
					</div>
				</div>

				<!-- Opplastede filer -->
				{#if themeFiles.length > 0}
					<ul class="uploaded-files-list">
						{#each themeFiles as uf (uf.id)}
							<li class="uploaded-file-row">
								<span class="uploaded-file-icon">{fileIcon(uf.fileType)}</span>
								<a class="uploaded-file-name" href={uf.url} target="_blank" rel="noopener noreferrer">{uf.name}</a>
								{#if uf.sizeBytes}
									<span class="uploaded-file-size">{formatBytes(uf.sizeBytes)}</span>
								{/if}
								<button class="uploaded-file-delete" onclick={() => deleteFile(uf.id)} aria-label="Slett {uf.name}">🗑</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
		</div>
	{/if}
	{/if}
</div>

<!-- Flow overlay -->
{#if selectedFlow}
	{@const flow = selectedFlow}
	<FlowSheet
		flow={flow}
		onclose={closeFlow}
		oncomplete={(data) => {
			handleFlowComplete(flow.id, data);
			closeFlow();
		}}
	/>
{/if}

<style>
	.theme-page {
		--theme-hue: 228;
		--tp-bg-0: hsl(var(--theme-hue) 22% 8%);
		--tp-bg-1: hsl(var(--theme-hue) 20% 10%);
		--tp-bg-2: hsl(var(--theme-hue) 24% 13%);
		--tp-border: hsl(var(--theme-hue) 16% 18%);
		--tp-border-strong: hsl(var(--theme-hue) 28% 34%);
		--tp-text: hsl(var(--theme-hue) 20% 92%);
		--tp-text-soft: hsl(var(--theme-hue) 18% 70%);
		--tp-text-muted: hsl(var(--theme-hue) 12% 46%);
		--tp-accent: hsl(var(--theme-hue) 70% 70%);
		--tp-accent-bg: hsl(var(--theme-hue) 40% 22%);
		--tp-accent-bg-strong: hsl(var(--theme-hue) 42% 28%);
		min-height: 100dvh;
		background:
			radial-gradient(120% 90% at 50% -10%, hsl(var(--theme-hue) 72% 60% / 0.12), transparent 52%),
			linear-gradient(180deg, var(--tp-bg-1) 0%, var(--tp-bg-0) 100%);
		color: var(--tp-text-soft);
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	.tp-launch {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(110% 80% at 50% -10%, hsl(var(--theme-hue) 75% 62% / 0.22), transparent 55%),
			linear-gradient(180deg, var(--tp-bg-2) 0%, var(--tp-bg-0) 100%);
		animation: launchBackdrop 0.9s ease;
	}

	.tp-archived {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(90% 70% at 50% -10%, hsl(var(--theme-hue) 70% 60% / 0.18), transparent 58%),
			linear-gradient(180deg, var(--tp-bg-2) 0%, var(--tp-bg-0) 100%);
		animation: launchBackdrop 0.45s ease;
	}

	.tp-archived-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid var(--tp-border-strong);
		border-radius: 999px;
		background: var(--tp-accent-bg);
		color: var(--tp-text);
		font-size: 0.8rem;
	}

	.tp-archived-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--tp-accent-bg-strong);
		border: 1px solid var(--tp-border-strong);
	}

	.tp-archived-title {
		margin: 0;
		font-size: clamp(1.7rem, 5.3vw, 2.2rem);
		letter-spacing: -0.03em;
		color: var(--tp-text);
	}

	.tp-archived-copy {
		margin: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft);
	}

	.tp-launch-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid var(--tp-border-strong);
		border-radius: 999px;
		background: var(--tp-accent-bg);
		color: var(--tp-text);
		font-size: 0.8rem;
		animation: launchDrop 0.5s cubic-bezier(0.2, 0.84, 0.24, 1);
	}

	.tp-launch-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--tp-accent-bg-strong);
		border: 1px solid var(--tp-border-strong);
	}

	.tp-launch-title {
		margin: 0;
		font-size: clamp(1.8rem, 5.4vw, 2.3rem);
		letter-spacing: -0.03em;
		color: var(--tp-text);
		animation: launchRise 0.58s ease;
	}

	.tp-launch-copy {
		margin: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft);
		animation: launchFade 0.65s ease;
	}

	.tp-enter {
		animation: contentRise 0.4s ease;
	}

	@keyframes launchBackdrop {
		from {
			opacity: 0.1;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes launchDrop {
		from {
			opacity: 0;
			transform: translateY(-28px) scale(0.94);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes launchRise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes launchFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes contentRise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ── Header ── */
	.tp-header {
		padding: var(--screen-title-top-pad, 34px) 20px 16px;
		border-bottom: 1px solid var(--tp-border);
	}



	/* ── Tabs ── */
	.tp-tabs {
		display: flex;
		border-bottom: 1px solid var(--tp-border);
		padding: 0 12px;
		gap: 4px;
	}

	.tp-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--tp-text-muted);
		font: inherit;
		font-size: 0.78rem;
		padding: 10px 12px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.tp-tab.active {
		color: var(--tp-text);
		border-bottom-color: var(--tp-accent);
	}

	.tp-tab:hover:not(.active) {
		color: var(--tp-text-soft);
	}

	/* ── Body ── */
	.tp-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Chat tab ── */
	.chat-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: calc(100dvh - 160px);
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.bubble-user {
		align-self: flex-end;
		background: hsl(var(--theme-hue) 28% 14%);
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 78%;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--tp-text);
	}

	.bubble-img {
		align-self: flex-end;
		max-width: 78%;
		max-height: 280px;
		object-fit: contain;
		border-radius: 12px;
		border: 1px solid hsl(var(--theme-hue) 24% 26%);
		margin-bottom: 4px;
	}

	.chat-image-preview {
		position: relative;
		display: inline-flex;
		align-items: flex-start;
		margin-bottom: 6px;
	}

	.chat-image-thumb {
		max-height: 80px;
		max-width: 120px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid hsl(var(--theme-hue) 24% 30%);
	}

	.chat-image-remove {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #222;
		border: 1px solid #555;
		color: #ccc;
		font-size: 14px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}

	.chat-empty {
		color: #333;
		font-size: 0.82rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.chat-error {
		color: #e07070;
		font-size: 0.8rem;
		text-align: center;
	}

	.chat-input-wrap {
		padding: 10px 12px env(safe-area-inset-bottom, 12px);
		border-top: 1px solid #1a1a1a;
	}

	@media (prefers-reduced-motion: reduce) {
		.tp-launch,
		.tp-launch-chip,
		.tp-launch-title,
		.tp-launch-copy,
		.tp-archived,
		.tp-enter {
			animation: none !important;
		}
	}

	/* ── Data tab ── */
	.data-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.data-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
		text-align: center;
	}

	.data-empty-tight {
		padding-top: 8px;
	}

	.data-new-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 16px;
		border-radius: 99px;
		cursor: pointer;
	}

	.signal-collapsed-wrap {
		margin-top: 6px;
		border: 1px solid #242424;
		border-radius: 12px;
		background: #0f0f0f;
		overflow: hidden;
	}

	.signal-collapsed-summary {
		list-style: none;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 600;
		color: #d7d7d7;
	}

	.signal-collapsed-summary::-webkit-details-marker {
		display: none;
	}

	.signal-collapsed-count {
		font-size: 0.72rem;
		color: #8e9cff;
	}

	.signal-collapsed-body {
		padding: 0 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-top: 1px solid #1e1e1e;
	}

	.signal-panel-copy {
		margin: 0;
		font-size: 0.78rem;
		color: #7d7d7d;
	}

	.signal-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.signal-item {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		justify-content: space-between;
		padding: 10px;
		border-radius: 10px;
		border: 1px solid #242424;
		background: #141414;
	}

	.signal-item-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.signal-item-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.signal-item-title-row strong {
		font-size: 0.8rem;
		color: #ddd;
		word-break: break-word;
	}

	.signal-owner {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9a9a9a;
	}

	.signal-item-desc,
	.signal-item-latest {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.4;
		color: #8a8a8a;
	}

	.signal-item input[type='checkbox'] {
		width: 18px;
		height: 18px;
		margin-top: 2px;
	}

	.signal-state {
		margin: 0;
		font-size: 0.78rem;
		color: #9a9a9a;
	}

	.signal-state-error {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		color: #ee8c8c;
	}

	.signal-retry-btn {
		border: 1px solid #3a3a3a;
		background: #1a1a1a;
		color: #ddd;
		border-radius: 999px;
		padding: 6px 10px;
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
	}

	.goals-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.goal-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
		padding: 14px;
		display: flex;
		gap: 14px;
		align-items: center;
		position: relative;
	}

	.goal-card-editing {
		padding: 16px;
	}

	.goal-ring {
		flex-shrink: 0;
	}

	.goal-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.goal-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.goal-desc {
		font-size: 0.72rem;
		color: #555;
		line-height: 1.4;
	}

	.goal-status {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.goal-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-left: auto;
	}

	.goal-action-btn {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #888;
		font-size: 0.96rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.goal-action-btn:hover {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}

	.goal-edit-btn:hover {
		color: #7c8ef5;
		border-color: #3c4f9f;
	}

	.goal-delete-btn:hover {
		color: #ee8c8c;
		border-color: #9e4545;
	}

	.goal-edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.goal-edit-label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.78rem;
		color: #9b9b9b;
	}

	.goal-edit-input {
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
	}

	.goal-edit-input[type='date'] {
		padding: 8px 12px;
		cursor: pointer;
		color-scheme: dark;
	}

	.goal-edit-input[type='date']::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
		opacity: 0.8;
		transition: opacity 0.15s ease;
	}

	.goal-edit-input[type='date']::-webkit-calendar-picker-indicator:hover {
		opacity: 1;
	}

	.goal-edit-input:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.goal-edit-textarea {
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
		resize: vertical;
	}

	.goal-edit-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.goal-edit-error {
		margin: 0;
		color: #ee8c8c;
		font-size: 0.72rem;
	}

	.goal-edit-actions {
		display: flex;
		gap: 8px;
	}

	.goal-edit-save {
		background: var(--tp-accent-bg-strong);
		color: var(--tp-text);
		border: 1px solid var(--tp-border-strong);
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.goal-edit-save:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.goal-edit-cancel {
		background: #1a1a1a;
		color: #999;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.goal-edit-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ── Mål tab ── */
	.goals-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.goals-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.goals-section-title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		color: #e8e8e8;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.goals-section-copy {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #666;
	}

	.goals-create-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
	}

	.goal-control {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.goal-control-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #9b9b9b;
		margin: 0;
	}

	.goal-control-row {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.goal-control-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.75rem;
		color: #888;
		flex: 1;
		min-width: 140px;
	}

	.goal-control-input {
		width: 100%;
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
	}

	.goal-control-input[type="date"] {
		padding: 8px 12px;
		cursor: pointer;
		color-scheme: dark;
	}

	.goal-control-input[type="date"]::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
		opacity: 0.8;
		transition: opacity 0.15s ease;
	}

	.goal-control-input[type="date"]::-webkit-calendar-picker-indicator:hover {
		opacity: 1;
	}

	.goal-control-input:focus {
		outline: none;
		border-color: var(--tp-border-strong);
		box-shadow: 0 0 0 2px hsl(var(--theme-hue) 50% 44% / 0.16);
	}

	.goal-control-actions {
		display: flex;
		gap: 8px;
	}

	.goal-control-save {
		background: var(--tp-accent-bg-strong);
		color: var(--tp-text);
		border: 1px solid var(--tp-border-strong);
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.goal-control-save:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.goal-control-cancel {
		background: #1a1a1a;
		color: #999;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.goal-control-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.goal-control-error {
		margin: 0;
		color: #ee8c8c;
		font-size: 0.72rem;
	}

	.goal-type-selector {
		display: flex;
		gap: 12px;
	}

	.goal-type-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: var(--tp-accent);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 10px 18px;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.goal-type-btn:hover {
		background: #242424;
		border-color: var(--tp-border-strong);
	}

	.goals-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
		text-align: center;
	}

	.goals-new-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: var(--tp-accent);
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 16px;
		border-radius: 99px;
		cursor: pointer;
	}

	/* ── Flyter tab ── */
	.flows-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.flows-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* ── Filer tab ── */
	.files-panel {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.files-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.files-count {
		font-size: 0.75rem;
		color: #444;
	}

	.files-upload-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #666;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 14px;
		border-radius: 99px;
		cursor: pointer;
	}

	.files-upload-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.instruction-file {
		border: 1px solid #242424;
		border-radius: 14px;
		background: #131313;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.instruction-file-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.instruction-file-icon {
		font-size: 0.98rem;
		opacity: 0.7;
	}

	.instruction-file-name {
		font-size: 0.86rem;
		font-weight: 600;
		color: #aaa;
	}

	.instruction-editor {
		width: 100%;
		border-radius: 12px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		padding: 12px;
		resize: vertical;
		min-height: 180px;
	}

	.instruction-editor:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.instruction-foot {
		font-size: 0.8rem;
	}

	.instruction-saved {
		color: #74cf9e;
	}

	.instruction-error {
		color: #ee8c8c;
	}

	.instruction-empty {
		color: #777;
	}

	.files-save-btn {
		margin-left: auto;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #888;
		font: inherit;
		font-size: 0.78rem;
		padding: 4px 12px;
		border-radius: 99px;
		cursor: pointer;
	}

	.files-save-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.files-upload-input {
		display: none;
	}

	.file-upload-error {
		margin: 0;
		padding: 8px 12px;
		border-radius: 10px;
		background: #1f1010;
		border: 1px solid #3a1a1a;
		color: #ee8c8c;
		font-size: 0.82rem;
	}

	.uploaded-files-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.uploaded-file-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid #242424;
		border-radius: 12px;
		background: #131313;
	}

	.uploaded-file-icon {
		font-size: 1rem;
		opacity: 0.8;
		flex-shrink: 0;
	}

	.uploaded-file-name {
		flex: 1;
		font-size: 0.86rem;
		font-weight: 600;
		color: #aaa;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.uploaded-file-name:hover {
		color: #c8c8f8;
	}

	.uploaded-file-size {
		font-size: 0.78rem;
		color: #555;
		flex-shrink: 0;
	}

	.uploaded-file-delete {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.9rem;
		opacity: 0.5;
		padding: 2px 4px;
		border-radius: 6px;
		flex-shrink: 0;
		transition: opacity 0.12s;
	}

	.uploaded-file-delete:hover {
		opacity: 1;
	}

	/* ── Samtaler-liste ── */
	.conv-list-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 12px 0 env(safe-area-inset-bottom, 16px);
	}

	.conv-list-actions {
		display: flex;
		justify-content: flex-end;
		padding: 0 16px 10px;
	}

	.conv-new-btn {
		background: #1e1e1e;
		border: 1px solid #2e2e2e;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 16px;
		border-radius: 99px;
		cursor: pointer;
		transition: background 0.12s;
	}

	.conv-new-btn:hover:not(:disabled) {
		background: #222;
	}

	.conv-new-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.conv-list {
		display: flex;
		flex-direction: column;
	}

	.conv-item {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 16px;
		background: none;
		border: none;
		border-bottom: 1px solid #1a1a1a;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}

	.conv-item:hover {
		background: #161616;
	}

	.conv-item-main {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}

	.conv-item-title {
		font-size: 0.88rem;
		font-weight: 600;
		color: #d4d4d4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.conv-item-date {
		flex-shrink: 0;
		font-size: 0.72rem;
		color: #555;
	}

	.conv-item-preview {
		margin: 0;
		font-size: 0.78rem;
		color: #555;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.conv-list-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
	}

	.conv-list-loading {
		padding: 24px 16px;
		color: #444;
		font-size: 0.82rem;
		text-align: center;
	}

	.conv-back-bar {
		padding: 8px 16px 4px;
		border-bottom: 1px solid var(--tp-border);
	}

	.conv-back-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--tp-accent);
		font: inherit;
		font-size: 0.82rem;
		padding: 4px 0;
		cursor: pointer;
	}

	.conv-back-btn:hover {
		color: var(--tp-text);
	}

	.chat-workout-context {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		margin: 0 0 12px;
		border-radius: 18px;
		background: color-mix(in srgb, var(--theme-hue, #7c8ef5) 12%, #0e1118 88%);
		border: 1px solid color-mix(in srgb, var(--theme-hue, #7c8ef5) 34%, #1d2230 66%);
	}

	.chat-workout-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
	}

	.chat-workout-head h3,
	.chat-workout-head p,
	.chat-workout-kicker,
	.chat-workout-source {
		margin: 0;
	}

	.chat-workout-kicker {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #b7c3df;
	}

	.chat-workout-head h3 {
		font-size: 1rem;
		color: #f2f5ff;
	}

	.chat-workout-head p,
	.chat-workout-source {
		font-size: 0.88rem;
		color: #b7c3df;
	}

	.chat-workout-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chat-workout-metrics span {
		padding: 6px 10px;
		border-radius: 999px;
		background: rgba(10, 13, 20, 0.46);
		border: 1px solid rgba(196, 206, 255, 0.14);
		font-size: 0.84rem;
		color: #edf1ff;
	}

	.chat-workout-data-btn {
		padding: 8px 12px;
		border-radius: 999px;
		border: 1px solid rgba(196, 206, 255, 0.18);
		background: rgba(10, 13, 20, 0.46);
		color: #edf1ff;
		cursor: pointer;
	}

	/* Flows grid */
	.flows-section-title {
		margin: 0 0 6px 0;
		padding: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--tp-text);
		letter-spacing: -0.02em;
	}

	.flows-section-copy {
		margin: 0 0 18px 0;
		padding: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft);
		line-height: 1.5;
	}

	.flows-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
		margin-bottom: 24px;
	}

	.flows-empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--tp-text-muted);
		font-size: 0.88rem;
		border: 1px dashed var(--tp-border);
		border-radius: 12px;
		background: var(--tp-bg-1);
	}

</style>
