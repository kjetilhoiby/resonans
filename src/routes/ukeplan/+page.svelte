<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { AppPage, PullToRefresh } from '$lib/components/ui';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { FlowContext } from '$lib/flows/types';
	import { finishNavMetric, startNavMetric } from '$lib/client/nav-metrics';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import { groupChecklistItems, activityEmoji, sortByTime, sortByStatus, formatItemTime, stripTimeFromText, type GroupedChecklistEntry } from '$lib/utils/checklist-group';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import ProcedureBadge from '$lib/components/ui/ProcedureBadge.svelte';
	import ProcedureSheet from '$lib/components/ui/ProcedureSheet.svelte';
	import WeatherStrip, { type WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import MentionPicker from '$lib/components/ui/MentionPicker.svelte';
	import { createMentionState } from '$lib/utils/mention-input.svelte';

	type SaveState = 'idle' | 'saving' | 'saved';

	interface WeekDay {
		isoDate: string;
		label: string;
		day: string;
	}

	interface WeekInfo {
		year: number;
		week: string;
		compactKey: string;
		dashedKey: string;
		contextKey: string;
		days: WeekDay[];
	}

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		parentId?: string | null;
		startDate?: string | null;
		endDate?: string | null;
		skippedAt?: string | null;
		snoozedToDate?: string | null;
		domain?: 'health' | 'economics' | 'food' | null;
		metadata?: {
			linkedTaskId?: string;
			linkedTaskTitle?: string;
			activityType?: string;
			durationMinutes?: number;
			distanceKm?: number;
			autoChecked?: boolean;
			timeHour?: number;
			timeMinute?: number;
		} | null;
	}

	interface WeekChecklist {
		id: string;
		title: string;
		emoji: string;
		completedAt: string | null;
		planConversationId?: string | null;
		items: ChecklistItem[];
	}

	interface WeekTask {
		id: string;
		title: string;
		frequency: string | null;
		targetValue: number | null;
		unit: string | null;
		metadata: any;
		repeatCount: number;
		completedCount: number;
		goalTitle: string | null;
		themeName: string | null;
	}

	interface GoalReminder {
		id: string;
		title: string;
		targetDate: string | null;
		metadata: any;
		sensorProgress:
			| {
					kind: 'running_distance';
					currentKm: number;
					expectedKm: number;
					targetKm: number;
					status: 'green' | 'yellow' | 'red';
			  }
			| {
					kind: 'weight_change';
					startDate: string;
					endDate: string;
					startWeight: number;
					currentWeight: number;
					expectedWeight: number;
					targetWeight: number;
					status: 'green' | 'yellow' | 'red';
					points: { date: string; weight: number }[];
			  }
			| null;
	}

	interface DayChecklist {
		id: string;
		title: string;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface EditingItem {
		checklistId: string;
		itemId: string;
		text: string;
	}

	interface EditingTask {
		taskId: string;
		title: string;
		originalTitle: string;
	}

	interface Props {
		data: {
			week: WeekInfo;
			weekNav: {
				previousWeekKey: string;
				nextWeekKey: string;
				isCurrentWeek: boolean;
			};
			weekChecklist: WeekChecklist | null;
			weekTasks: WeekTask[];
			weekNote: string;
			reflection: string;
			vision: string;
			longTermGoals: GoalReminder[];
			dayChecklists: Record<string, DayChecklist>;
			dayNotes: Record<string, string>;
			dayHeadlines: Record<string, string>;
			activeTrips: Array<{
				id: string;
				name: string;
				emoji: string | null;
				destination: string | null;
				startDate: string;
				endDate: string;
			}>;
			spondEventsByDay: Record<string, Array<{
				id: string;
				name: string;
				startTimestamp: string;
				endTimestamp: string;
				cancelled: boolean;
				groupName: string | null;
				location: { name: string | null; address: string | null } | null;
				rsvp: 'accepted' | 'declined' | 'unanswered' | 'unknown';
				spondEventId: string | null;
			}>>;
			previousWeekSummary: {
				weekKey: string;
				note: string;
				reflection: string;
				carryoverItems: string[];
				incompleteTasks: string[];
			};
		};
	}

	function toLocalIsoDate(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getIsoWeekDashedFromIsoDate(isoDate: string) {
		const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
		const year = Number.parseInt(yearRaw ?? '', 10);
		const month = Number.parseInt(monthRaw ?? '', 10);
		const day = Number.parseInt(dayRaw ?? '', 10);
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
			return data.week.dashedKey;
		}

		const d = new Date(Date.UTC(year, month - 1, day));
		const dayNum = d.getUTCDay() || 7;
		d.setUTCDate(d.getUTCDate() + 4 - dayNum);
		const isoYear = d.getUTCFullYear();
		const yearStart = new Date(Date.UTC(isoYear, 0, 1));
		const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
		const week = String(weekNo).padStart(2, '0');
		return `${isoYear}-W${week}`;
	}

	function addDaysIsoDate(isoDate: string, days: number) {
		const date = new Date(`${isoDate}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	}

	let { data }: Props = $props();
	const todayIso = toLocalIsoDate(new Date());
	const tomorrowIso = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return toLocalIsoDate(t); })();
	const dayFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('day')
		: null;
	const nudgeTrackFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('nudgeTrack')
		: null;
	const nudgeEventIdFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('nudgeEventId')
		: null;
	const selectedDefault = data.week.days.some((d) => d.isoDate === dayFromQuery)
		? (dayFromQuery as string)
		: (data.week.days.some((d) => d.isoDate === todayIso) ? todayIso : data.week.days[0].isoDate);
	let selectedDayIso = $state(selectedDefault);
	let weekChecklistState = $state<WeekChecklist | null>(data.weekChecklist ? structuredClone(data.weekChecklist) : null);
	let dayChecklistsState = $state<Record<string, DayChecklist>>(structuredClone(data.dayChecklists));
	let weekNoteValue = $state(data.weekNote);
	let reflectionValue = $state(data.reflection);
	let visionValue = $state(data.vision);
	let weekComposerText = $state('');
	let dayComposerText = $state('');
let dayHeadlinesState = $state<Record<string, string>>(structuredClone(data.dayHeadlines));
	let planningImportBusy = $state(false);
	let dayCloseBusy = $state(false);
	let dayCloseMessage = $state('');
	let dayPlanSheetOpen = $state(false);
	let dayPlanSheetBusy = $state(false);
	let dayPlanSheetCarryovers = $state<string[]>([]);
	let dayPlanSheetWeekTasks = $state<string[]>([]);
	let nudgeFlowStarted = $state(false);
	let nudgeFlowCompleted = $state(false);
	let dayCloseFlowOpen = $state(false);
	let dayCloseDecisions = $state<Record<string, 'carryover' | 'unsolved'>>({});
	let weekPlanFlowOpen = $state(false);
	let weekPlanFlowContext = $state<FlowContext>({});
	let openingWeekPlanFlow = $state(false);
	let weekPlanJustCompleted = $state(false);
	let foodChatOpen = $state(false);
	let foodChatItemText = $state('');

	function openFoodChatForItem(text: string) {
		foodChatItemText = text;
		foodChatOpen = true;
	}
	let editingItem = $state<EditingItem | null>(null);
	let breakdownTarget = $state<{ checklistId: string; item: ChecklistItem } | null>(null);
	let editingTask = $state<EditingTask | null>(null);
	let editTaskInput = $state<HTMLInputElement | null>(null);
	let skipEditTask = false;

	// Procedure matching state
	interface ProcedureMatch {
		procedureId: string;
		title: string;
		emoji: string | null;
	}
	let procedureMatches = $state<Map<string, ProcedureMatch>>(new Map());
	let procedureSheetId = $state<string | null>(null);
	let procedureSheetData = $state<any>(null);
	let taskContextMenuItem = $state<WeekTask | null>(null);
	let taskContextMenuRect = $state<DOMRect | null>(null);
	let taskLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let taskLongPressTriggered = $state(false);

	async function loadProcedureMatches() {
		if (data.weekTasks.length === 0) return;
		const results = new Map<string, ProcedureMatch>();
		for (const task of data.weekTasks) {
			if (task.metadata?.matchedProcedureId) {
				results.set(task.id, {
					procedureId: task.metadata.matchedProcedureId,
					title: task.metadata.matchedProcedureTitle ?? 'Oppskrift',
					emoji: task.metadata.matchedProcedureEmoji ?? null
				});
				continue;
			}
			try {
				const res = await fetch('/api/procedures/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ taskTitle: task.title })
				});
				const { matches } = await res.json();
				if (matches?.length > 0) {
					results.set(task.id, {
						procedureId: matches[0].procedureId,
						title: matches[0].title,
						emoji: matches[0].emoji
					});
				}
			} catch { /* ignore */ }
		}
		procedureMatches = results;
	}

	async function openProcedureSheet(procedureId: string) {
		try {
			const res = await fetch(`/api/procedures/${procedureId}`);
			if (!res.ok) return;
			procedureSheetData = await res.json();
			procedureSheetId = procedureId;
		} catch { /* ignore */ }
	}

	function handleTaskPressStart(e: PointerEvent, task: WeekTask) {
		if (editingTask) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		taskLongPressTriggered = false;
		taskLongPressTimer = setTimeout(() => {
			taskLongPressTriggered = true;
			taskContextMenuItem = task;
			taskContextMenuRect = rect;
		}, LONG_PRESS_MS);
	}

	function handleTaskPressEnd() {
		if (taskLongPressTimer) {
			clearTimeout(taskLongPressTimer);
			taskLongPressTimer = null;
		}
	}

	async function handleTaskStartChat(task: WeekTask) {
		try {
			const res = await fetch('/api/conversations/new', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: `Oppgave: ${task.title}`,
					sourceContext: { sourceTaskId: task.id, sourceItemText: task.title }
				})
			});
			if (!res.ok) {
				goto('/samtaler');
				return;
			}
			const { conversationId } = await res.json();
			goto(`/samtaler?conversation=${conversationId}`);
		} catch {
			goto('/samtaler');
		}
	}

	$effect(() => { loadProcedureMatches(); });
	const taskMention = createMentionState();
	let taskMentionPickerEl = $state<ReturnType<typeof MentionPicker> | null>(null);
	let dragItem = $state<{ checklistId: string; itemId: string } | null>(null);
	let dragOverItemId = $state<string | null>(null);
	let skipEditBlur = false;
	let weekComposerInput = $state<HTMLInputElement | null>(null);
	let dayComposerInput = $state<HTMLInputElement | null>(null);
	let editInput = $state<HTMLInputElement | null>(null);
	let weekPickerInput = $state<HTMLInputElement | null>(null);
	let expandedDayParentIds = $state<Set<string>>(new Set());
	let expandedWeekParentIds = $state<Set<string>>(new Set());
	// Kontekstmeny ved langtrykk
	let contextMenuItem = $state<{ checklistId: string; item: ChecklistItem } | null>(null);
	let contextMenuRect = $state<DOMRect | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTriggered = $state(false);
	const LONG_PRESS_MS = 600;
	let saveStates = $state<Record<string, SaveState>>({
		weekNote: 'idle',
		weekItems: 'idle',
		dayItems: 'idle',
		dayNote: 'idle',
		weekReview: 'idle'
	});

	const selectedDayChecklist = $derived(dayChecklistsState[selectedDayIso] ?? null);
	const sortedDayItems = $derived(selectedDayChecklist ? sortByStatus(sortByTime(selectedDayChecklist.items.filter((item) => !item.parentId))) : []);
	const selectedDay = $derived(data.week.days.find((day) => day.isoDate === selectedDayIso) ?? data.week.days[0]);
	const selectedDayHeadline = $derived(dayHeadlinesState[selectedDayIso] ?? '');
	const selectedDaySpondEvents = $derived(data.spondEventsByDay?.[selectedDayIso] ?? []);
	const hasOpenDayItems = $derived(selectedDayChecklist ? selectedDayChecklist.items.some((i) => !i.checked) : false);
	const hasCarryovers = $derived(data.previousWeekSummary.carryoverItems.length > 0 || data.previousWeekSummary.incompleteTasks.length > 0);
	const hasPreviousWeekContext = $derived(hasCarryovers || !!data.previousWeekSummary.note || !!data.previousWeekSummary.reflection);

	const _now = new Date();
	const _isAfter18 = _now.getHours() >= 18;

	const weekIsPlanned = $derived(!!data.weekNote || (weekChecklistState?.items.length ?? 0) > 0);
	const dayIsPlanned = $derived(!!selectedDayHeadline);

	const showPlanWeek = $derived(!weekIsPlanned); // TODO: restore condition: hasPreviousWeekContext && !weekIsPlanned
	const showPlanDay = $derived(!dayIsPlanned);
	const showCloseDay = $derived(_isAfter18 && hasOpenDayItems);
	const nudgeTrack = nudgeTrackFromQuery;
	const nudgeEventId = nudgeEventIdFromQuery;

	// Sync day headlines from server after invalidation (e.g. after AI saves via plan_day tool)
	$effect(() => {
		dayHeadlinesState = { ...data.dayHeadlines };
	});

	async function reportNudgeStage(stage: 'flow_started' | 'flow_completed') {
		if (!nudgeEventId) return;
		if (stage === 'flow_started' && nudgeFlowStarted) return;
		if (stage === 'flow_completed' && nudgeFlowCompleted) return;

		try {
			await fetch(`/api/nudges/events/${nudgeEventId}/stage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage })
			});
			if (stage === 'flow_started') nudgeFlowStarted = true;
			if (stage === 'flow_completed') nudgeFlowCompleted = true;
		} catch {
			// best effort only
		}
	}

	// Map iso-date → trip emoji for days that are part of a trip
	const tripDayEmoji = $derived.by(() => {
		const map: Record<string, string> = {};
		for (const trip of data.activeTrips) {
			for (const day of data.week.days) {
				if (day.isoDate >= trip.startDate && day.isoDate <= trip.endDate) {
					map[day.isoDate] = trip.emoji ?? '🗺️';
				}
			}
		}
		return map;
	});

	// Weather for trip days — fetched client-side per trip destination
	interface DayWeatherEntry { symbol: string; tempMax: number }
	let tripDayWeather = $state<Record<string, DayWeatherEntry>>({});

	// Home weather — fetched via geolocation for non-trip days
	interface DayWeatherSummary { emoji: string; tempMax: number; periods: WeatherPeriod[] }
	let homeDayWeather = $state<Record<string, DayWeatherSummary>>({});

	// "worst weather" priority (higher = shown over better weather)
	function weatherSeverity(symbol: string): number {
		if (symbol.includes('thunder')) return 6;
		if (symbol.includes('snow')) return 5;
		if (symbol.includes('sleet')) return 4;
		if (symbol.includes('rain') || symbol.includes('shower')) return 3;
		if (symbol.startsWith('fog')) return 2;
		if (symbol.startsWith('cloudy') || symbol.startsWith('partlycloudy')) return 1;
		return 0; // clear/fair
	}

	function metSymbolToEmoji(symbol: string): string {
		if (symbol.startsWith('clearsky')) return '☀️';
		if (symbol.startsWith('fair')) return '🌤️';
		if (symbol.startsWith('partlycloudy')) return '⛅';
		if (symbol.startsWith('cloudy')) return '☁️';
		if (symbol.startsWith('fog')) return '🌫️';
		if (symbol.includes('thunder')) return '⛈️';
		if (symbol.includes('snow') || symbol.includes('sleet')) return '❄️';
		if (symbol.includes('rain') || symbol.includes('shower')) return '🌧️';
		return '🌡️';
	}

	import { onMount } from 'svelte';

	function smartDayLabel(isoDate: string): string {
		if (isoDate === todayIso) return 'I dag';
		const raw = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(isoDate + 'T12:00:00'));
		const clean = raw.replace('.', '');
		return clean.charAt(0).toUpperCase() + clean.slice(1);
	}

	function parseDayPeriods(
		timeseries: Array<{
			time: string;
			data: {
				instant: { details: { air_temperature: number } };
				next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
				next_6_hours?: { summary?: { symbol_code?: string } };
			};
		}>,
		dateIso: string
	): WeatherPeriod[] {
		const PERIODS = [
			{ key: 'natt',        label: 'Natt',        hourStart: 0,  representative: 2  },
			{ key: 'morgen',      label: 'Morgen',      hourStart: 6,  representative: 8  },
			{ key: 'ettermiddag', label: 'Ettermiddag', hourStart: 12, representative: 14 },
			{ key: 'kveld',       label: 'Kveld',       hourStart: 18, representative: 20 },
		];

		// Map UTC time → local (Oslo) hour
		const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false });
		const fmtDate = new Intl.DateTimeFormat('sv',    { timeZone: 'Europe/Oslo' });

		const byHour: Record<number, typeof timeseries[0]> = {};
		for (const entry of timeseries) {
			if (fmtDate.format(new Date(entry.time)) !== dateIso) continue;
			const h = parseInt(fmtHour.format(new Date(entry.time)), 10) % 24;
			byHour[h] = entry;
		}

		const result: WeatherPeriod[] = [];

		for (const { key, label, hourStart, representative } of PERIODS) {
			// Gather 6 hours for this period
			const entries = Array.from({ length: 6 }, (_, i) => byHour[hourStart + i]).filter(Boolean);
			if (!entries.length) continue;

			// Pick entry closest to representative hour
			const repr = entries.reduce((best, e) => {
				const hE = parseInt(fmtHour.format(new Date(e.time)), 10) % 24;
				const hB = parseInt(fmtHour.format(new Date(best.time)), 10) % 24;
				return Math.abs(hE - representative) < Math.abs(hB - representative) ? e : best;
			});

			const temp = Math.round(repr.data.instant.details.air_temperature);
			const symbol = repr.data.next_6_hours?.summary?.symbol_code
				?? repr.data.next_1_hours?.summary?.symbol_code
				?? 'cloudy';
			const precip = entries.reduce((s, e) => s + (e.data.next_1_hours?.details?.precipitation_amount ?? 0), 0);

			result.push({ key, label, emoji: metSymbolToEmoji(symbol), temp, precip: Math.round(precip * 10) / 10 });
		}

		return result;
	}
	onMount(async () => {
		finishNavMetric('ukeplan');
		const weekDates = new Set(data.week.days.map((d) => d.isoDate));
		for (const trip of data.activeTrips) {
			// Only fetch if some trip days overlap this week
			const hasDaysThisWeek = data.week.days.some(
				(d) => d.isoDate >= trip.startDate && d.isoDate <= trip.endDate
			);
			if (!hasDaysThisWeek) continue;
			// Geocode destination to get lat/lng
			try {
				const geoRes = await fetch(
					`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trip.destination ?? '')}&format=json&limit=1`,
					{ headers: { 'Accept-Language': 'nb,en' } }
				);
				const geoData: Array<{ lat: string; lon: string }> = await geoRes.json();
				if (!geoData.length) continue;
				const lat = parseFloat(geoData[0].lat);
				const lng = parseFloat(geoData[0].lon);

				const wxRes = await fetch(
					`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
					{ headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' } }
				);
				if (!wxRes.ok) continue;
				const wxData = await wxRes.json();
				const timeseries: Array<{
					time: string;
					data: {
						instant: { details: { air_temperature: number } };
						next_1_hours?: { summary?: { symbol_code?: string } };
						next_6_hours?: { summary?: { symbol_code?: string }; details?: { air_temperature_max?: number } };
					};
				}> = wxData.properties.timeseries;

				// Aggregate per day: worst symbol + highest tempMax
				type DayAgg = { temps: number[]; symbol?: string; severity: number };
				const dayMap = new Map<string, DayAgg>();
				for (const entry of timeseries) {
					const date = entry.time.slice(0, 10);
					if (!weekDates.has(date)) continue;
					if (!dayMap.has(date)) dayMap.set(date, { temps: [], severity: -1 });
					const agg = dayMap.get(date)!;
					agg.temps.push(entry.data.instant.details.air_temperature);
					const sym =
						entry.data.next_6_hours?.summary?.symbol_code ??
						entry.data.next_1_hours?.summary?.symbol_code;
					if (sym) {
						const sev = weatherSeverity(sym);
						if (sev > agg.severity) { agg.symbol = sym; agg.severity = sev; }
					}
					// Prefer noon symbol for "main" symbol if no worse one found
					if (entry.time.includes('T12:00:00Z') && !agg.symbol) {
						agg.symbol = sym;
					}
				}

				const newEntries: Record<string, DayWeatherEntry> = {};
				for (const [date, agg] of dayMap.entries()) {
					if (!agg.symbol) continue;
					const tempMax = agg.temps.length ? Math.round(Math.max(...agg.temps)) : 0;
					// Only overwrite if this trip has worse weather or higher temp
					const existing = tripDayWeather[date];
					if (!existing ||
						weatherSeverity(agg.symbol) > weatherSeverity(existing.symbol) ||
						(weatherSeverity(agg.symbol) === weatherSeverity(existing.symbol) && tempMax > existing.tempMax)) {
						newEntries[date] = { symbol: agg.symbol, tempMax };
					}
				}
				tripDayWeather = { ...tripDayWeather, ...newEntries };
			} catch {
				// best-effort; silently skip
			}
		}

		// Hent hjemvær via geolocation for ikke-tur-dager
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
			);
			const { latitude: lat, longitude: lng } = pos.coords;
			const wxRes = await fetch(
				`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
				{ headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' } }
			);
			if (wxRes.ok) {
				const wxData = await wxRes.json();
				const ts = wxData.properties.timeseries;
				const newHome: Record<string, DayWeatherSummary> = {};
				for (const day of data.week.days) {
					const periods = parseDayPeriods(ts, day.isoDate);
					if (!periods.length) continue;
					const midday = periods.find(p => p.key === 'ettermiddag') ?? periods.find(p => p.key === 'morgen') ?? periods[0];
					const tempMax = Math.max(...periods.map(p => p.temp));
					newHome[day.isoDate] = { emoji: midday.emoji, tempMax, periods };
				}
				homeDayWeather = newHome;
			}
		} catch {
			// Geolocation nektet eller utilgjengelig — vær er valgfritt
		}
	});

	function setSelectedDay(dayIso: string) {
		selectedDayIso = dayIso;
		dayPlanSheetOpen = false;
		if (typeof window !== 'undefined') {
			const params = new URLSearchParams(window.location.search);
			params.set('day', dayIso);
			const next = `${window.location.pathname}?${params.toString()}`;
			window.history.replaceState(window.history.state, '', next);
		}
	}

	function weekHref(weekKey: string) {
		const params = new URLSearchParams();
		params.set('week', weekKey);
		return `/ukeplan?${params.toString()}`;
	}

	function checklistProgress(checklist: WeekChecklist | null) {
		if (!checklist || checklist.items.length === 0) return { done: 0, total: 0, pct: 0 };
		const done = checklist.items.filter((item) => item.checked).length;
		const total = checklist.items.length;
		return {
			done,
			total,
			pct: Math.round((done / total) * 100)
		};
	}

	const progress = $derived(checklistProgress(weekChecklistState));

	function formatDate(iso: string | null) {
		if (!iso) return 'uten dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function slotState(task: WeekTask, index: number) {
		return task.completedCount > index;
	}

	function doneTask(task: WeekTask) {
		return task.completedCount >= task.repeatCount;
	}

	function formatStructuredTaskMeta(task: WeekTask) {
		if (!task.frequency) return null;

		if (typeof task.targetValue === 'number' && task.targetValue > 0) {
			if (task.frequency === 'daily') {
				return `${task.targetValue} ${task.unit || 'ganger'} per dag`;
			}
			if (task.frequency === 'weekly') {
				return `${task.targetValue} ${task.unit || 'ganger'} denne uka`;
			}
			if (task.frequency === 'monthly') {
				return `${task.targetValue} ${task.unit || 'ganger'} denne måneden`;
			}
		}

		const labels: Record<string, string> = {
			daily: 'daglig',
			weekly: 'ukentlig',
			monthly: 'månedlig',
			once: 'én gang'
		};

		return labels[task.frequency] ?? task.frequency;
	}

	function getTaskIntentBadge(task: WeekTask):
		| { label: string; tone: 'pending' | 'parsed' | 'failed' }
		| null {
		const status = task.metadata?.intentStatus;
		if (status === 'pending') return { label: 'Tolkes...', tone: 'pending' };
		if (status === 'parsed') return { label: 'Aktiv sporing', tone: 'parsed' };
		if (status === 'failed') return { label: 'Trenger avklaring', tone: 'failed' };
		return null;
	}

	function getTaskIntentFailureReasonLabel(task: WeekTask): string | null {
		if (task.metadata?.intentStatus !== 'failed') return null;
		const reason = task.metadata?.intentError;
		if (!reason) return null;

		const reasonMap: Record<string, string> = {
			empty_text: 'Ingen tekst å tolke.',
			unsupported_activity: 'Støtter foreløpig bare løpemål i denne flyten.',
			unsupported_period_or_threshold: 'Fant ikke tydelig frekvens som "X ganger per uke".',
			no_quantifiable_target: 'Fant ikke frekvens – legg til f.eks. "5 ganger per uke".',
			invalid_threshold: 'Kunne ikke lese målverdi for antall per uke.',
			unknown: 'Ukjent parse-feil.'
		};

		return reasonMap[reason] ?? `Tolking feilet (${reason}).`;
	}

	function getTaskEvaluationLabel(task: WeekTask): string | null {
		const e = task.metadata?.intentEvaluation;
		if (!e) return null;
		if (typeof e.currentValue !== 'number' || typeof e.targetValue !== 'number') return null;
		if (e.targetValue <= 0) return null;

		const pct = Math.max(0, Math.min(100, Math.round((e.currentValue / e.targetValue) * 100)));
		const metText = e.met ? 'oppnådd' : 'pågår';
		return `${e.currentValue}/${e.targetValue} denne uka (${pct}%) · ${metText}`;
	}

	// GroupedChecklistEntry, groupChecklistItems and activityEmoji are imported from $lib/utils/checklist-group

	let deletingTaskId = $state<string | null>(null);

	async function deleteTask(taskId: string) {
		deletingTaskId = taskId;
		try {
			const fd = new FormData();
			fd.set('taskId', taskId);
			await fetch('?/deleteTask', { method: 'POST', body: fd });
			await invalidateAll();
		} finally {
			deletingTaskId = null;
		}
	}

	async function saveEditTask() {
		if (skipEditTask) { skipEditTask = false; return; }
		if (!editingTask) return;
		const { taskId, title, originalTitle } = editingTask;
		editingTask = null;
		const trimmed = title.trim();
		if (!trimmed || trimmed === originalTitle) return;
		const fd = new FormData();
		fd.set('taskId', taskId);
		fd.set('title', trimmed);
		await fetch('?/updateTask', { method: 'POST', body: fd });
		await invalidateAll();
	}

	function markInitialValue(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		target.dataset.initialValue = target.value;
	}

	function submitOnBlurIfChanged(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		const form = target.closest('form');
		if (!form) return;

		const initial = target.dataset.initialValue ?? '';
		if (target.value === initial) return;

		const allowEmpty = form.dataset.allowEmptyAutosave === 'true';
		if (!allowEmpty && target.value.trim().length === 0) return;

		// Avoid submitting when focus just moved to another field in the same form.
		setTimeout(() => {
			if (form.contains(document.activeElement)) return;
			form.requestSubmit();
		}, 0);
	}

	function setSaveState(key: keyof typeof saveStates, state: SaveState) {
		saveStates = { ...saveStates, [key]: state };
	}

	function flashSaved(key: keyof typeof saveStates) {
		setSaveState(key, 'saved');
		setTimeout(() => {
			if (saveStates[key] === 'saved') {
				setSaveState(key, 'idle');
			}
		}, 1400);
	}

	function autosaveEnhance(key: keyof typeof saveStates, resetOnSuccess = false): SubmitFunction {
		return ({ formElement }) => {
			setSaveState(key, 'saving');
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					if (resetOnSuccess) formElement.reset();
					flashSaved(key);
					return;
				}

				setSaveState(key, 'idle');
			};
		};
	}

	function saveKeyForChecklist(checklistId: string) {
		return weekChecklistState?.id === checklistId ? 'weekItems' : 'dayItems';
	}

	function updateChecklistById(checklistId: string, updater: (checklist: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist) {
		if (weekChecklistState?.id === checklistId) {
			weekChecklistState = updater(weekChecklistState) as WeekChecklist;
			return;
		}

		for (const [key, checklist] of Object.entries(dayChecklistsState)) {
			if (checklist.id !== checklistId) continue;
			dayChecklistsState = {
				...dayChecklistsState,
				[key]: updater(checklist) as DayChecklist
			};
			return;
		}
	}

	function getChecklistById(checklistId: string) {
		if (weekChecklistState?.id === checklistId) return weekChecklistState;
		for (const checklist of Object.values(dayChecklistsState)) {
			if (checklist.id === checklistId) return checklist;
		}
		return null;
	}

	async function createChecklistItem(checklistId: string, text: string, count: number) {
		const trimmed = text.trim();
		if (!trimmed) return;

		const checklist = getChecklistById(checklistId);
		if (!checklist) return;

		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: trimmed,
				count,
				sortOrder: checklist.items.length
			})
		});

		if (!response.ok) {
			setSaveState(key, 'idle');
			return;
		}

		const created = await response.json() as ChecklistItem[];
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: [...current.items, ...created]
		}));
		flashSaved(key);
	}

	async function appendChecklistItems(checklistId: string, texts: string[]) {
		const checklist = getChecklistById(checklistId);
		let nextSortOrder = checklist?.items.length ?? 0;
		const created: ChecklistItem[] = [];

		for (const rawText of texts) {
			const text = rawText.trim();
			if (!text) continue;

			const response = await fetch(`/api/checklists/${checklistId}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, count: 1, sortOrder: nextSortOrder })
			});

			if (!response.ok) continue;
			const added = await response.json() as ChecklistItem[];
			created.push(...added);
			nextSortOrder += Math.max(added.length, 1);
		}

		if (created.length > 0 && checklist) {
			updateChecklistById(checklistId, (current) => ({
				...current,
				items: [...current.items, ...created]
			}));
		}

		return created;
	}

	async function handleBreakdownSave(subtasks: string[]) {
		if (!breakdownTarget) return;
		const { checklistId, item } = breakdownTarget;
		try {
			const res = await fetch('/api/breakdown/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parentItemId: item.id, subtasks, breakdownPrompt: item.text })
			});
			if (!res.ok) throw new Error('Failed to save breakdown');
			const result = await res.json() as { subtasks: ChecklistItem[] };
			updateChecklistById(checklistId, (current) => ({
				...current,
				items: [
					...current.items.map((i) => i.id === item.id
						? { ...i, metadata: { ...(i.metadata as Record<string, unknown> ?? {}), hasBreakdown: true } }
						: i),
					...(result.subtasks ?? [])
				]
			}));
			breakdownTarget = null;
		} catch (err) {
			console.error('Error saving breakdown:', err);
		}
	}

	async function setChecklistCompleted(checklistId: string, completed: boolean) {
		const completedAt = completed ? new Date().toISOString() : null;
		const response = await fetch(`/api/checklists/${checklistId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ completedAt })
		});

		if (!response.ok) return false;

		updateChecklistById(checklistId, (current) => ({
			...current,
			completedAt
		}));

		return true;
	}

	async function fetchDayChecklistByContext(context: string) {
		const response = await fetch(`/api/checklists?contexts=${encodeURIComponent(context)}`);
		if (!response.ok) return null;
		const rows = await response.json() as DayChecklist[];
		return rows[0] ?? null;
	}

	async function openDayPlanSheet() {
		if (dayPlanSheetBusy) return;
		if (nudgeTrack === 'plan_day') {
			await reportNudgeStage('flow_started');
		}
		dayPlanSheetBusy = true;

		const prevDayIso = addDaysIsoDate(selectedDayIso, -1);
		const prevWeekKey = getIsoWeekDashedFromIsoDate(prevDayIso);
		const prevContext = `week:${prevWeekKey}:day:${prevDayIso}`;
		const prevChecklist = await fetchDayChecklistByContext(prevContext);

		dayPlanSheetCarryovers = (prevChecklist?.items ?? [])
			.filter((item) => !item.checked)
			.map((item) => item.text.trim())
			.filter((text) => text.length > 0);

		dayPlanSheetWeekTasks = data.weekTasks
			.filter((task) => task.completedCount < task.repeatCount)
			.map((task) => task.title.trim())
			.filter((text) => text.length > 0);

		dayPlanSheetBusy = false;
		dayPlanSheetOpen = true;
	}

	function toggleDayParentExpansion(parentId: string) {
		const next = new Set(expandedDayParentIds);
		if (next.has(parentId)) next.delete(parentId);
		else next.add(parentId);
		expandedDayParentIds = next;
	}

	function toggleWeekParentExpansion(parentId: string) {
		const next = new Set(expandedWeekParentIds);
		if (next.has(parentId)) next.delete(parentId);
		else next.add(parentId);
		expandedWeekParentIds = next;
	}

	async function toggleChecklistItem(checklistId: string, itemId: string, checked: boolean) {
		const key = saveKeyForChecklist(checklistId);
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: current.items.map((item) => item.id === itemId ? { ...item, checked } : item)
		}));
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checked })
		});

		if (!response.ok) {
			updateChecklistById(checklistId, (current) => ({
				...current,
				items: current.items.map((item) => item.id === itemId ? { ...item, checked: !checked } : item)
			}));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function saveEditedItem() {
		if (!editingItem) return;
		const activeEdit = editingItem;
		const trimmed = activeEdit.text.trim();
		const checklist = getChecklistById(activeEdit.checklistId);
		if (!checklist) return;

		if (!trimmed) {
			await deleteChecklistItem(activeEdit.checklistId, activeEdit.itemId);
			return;
		}

		const existing = checklist.items.find((item) => item.id === activeEdit.itemId);
		if (!existing || existing.text === trimmed) {
			editingItem = null;
			return;
		}

		const key = saveKeyForChecklist(activeEdit.checklistId);
		updateChecklistById(activeEdit.checklistId, (current) => ({
			...current,
			items: current.items.map((item) => item.id === activeEdit.itemId ? { ...item, text: trimmed } : item)
		}));
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${activeEdit.checklistId}/items/${activeEdit.itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: trimmed })
		});

		if (!response.ok) {
			updateChecklistById(activeEdit.checklistId, (current) => ({
				...current,
				items: current.items.map((item) => item.id === activeEdit.itemId ? { ...item, text: existing.text } : item)
			}));
			setSaveState(key, 'idle');
			return;
		}

		editingItem = null;
		flashSaved(key);
	}

	async function deleteChecklistItem(checklistId: string, itemId: string) {
		const checklist = getChecklistById(checklistId);
		if (!checklist) return;
		const previousItems = checklist.items;
		const nextItems = previousItems.filter((item) => item.id !== itemId);
		const key = saveKeyForChecklist(checklistId);

		updateChecklistById(checklistId, (current) => ({ ...current, items: nextItems }));
		editingItem = null;
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			updateChecklistById(checklistId, (current) => ({ ...current, items: previousItems }));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function reorderChecklistItems(checklistId: string, sourceId: string, targetId: string) {
		if (sourceId === targetId) return;
		const checklist = getChecklistById(checklistId);
		if (!checklist) return;

		const sourceIndex = checklist.items.findIndex((item) => item.id === sourceId);
		const targetIndex = checklist.items.findIndex((item) => item.id === targetId);
		if (sourceIndex === -1 || targetIndex === -1) return;

		const reordered = [...checklist.items];
		const [moved] = reordered.splice(sourceIndex, 1);
		reordered.splice(targetIndex, 0, moved);
		updateChecklistById(checklistId, (current) => ({ ...current, items: reordered }));

		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');

		const results = await Promise.all(
			reordered.map((item, index) =>
				fetch(`/api/checklists/${checklistId}/items/${item.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sortOrder: index })
				})
			)
		);

		if (results.some((result) => !result.ok)) {
			updateChecklistById(checklistId, (current) => ({ ...current, items: checklist.items }));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function startEditing(checklistId: string, item: ChecklistItem) {
		editingItem = { checklistId, itemId: item.id, text: item.text };
		await tick();
		editInput?.focus();
		editInput?.select();
	}

	function handleEditPress(checklistId: string, item: ChecklistItem) {
		// Når langtrykk åpner kontekstmenyen skal vanlig klikk ikke også starte redigering.
		if (longPressTriggered) {
			longPressTriggered = false;
			return;
		}
		void startEditing(checklistId, item);
	}

	function handleContextPressStart(event: PointerEvent, checklistId: string, item: ChecklistItem) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		longPressTriggered = false;
		if (longPressTimer) clearTimeout(longPressTimer);
		longPressTimer = setTimeout(() => {
			longPressTriggered = true;
			contextMenuItem = { checklistId, item };
			contextMenuRect = rect;
			longPressTimer = null;
		}, LONG_PRESS_MS);
	}

	function handleContextPressEnd() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	async function setItemSkipped(checklistId: string, itemId: string, skipped: boolean) {
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: current.items.map((i) =>
				i.id === itemId
					? { ...i, skippedAt: skipped ? new Date().toISOString() : null, snoozedToDate: skipped ? i.snoozedToDate : null, checked: skipped ? false : i.checked }
					: i
			)
		}));
		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');
		const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ skipped })
		});
		if (!res.ok) {
			setSaveState(key, 'idle');
			await invalidateAll();
			return;
		}
		flashSaved(key);
	}

	async function snoozeItem(checklistId: string, itemId: string, targetDate: string) {
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: current.items.map((i) =>
				i.id === itemId
					? { ...i, skippedAt: new Date().toISOString(), snoozedToDate: targetDate, checked: false }
					: i
			)
		}));
		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');
		const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}/snooze`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetDate })
		});
		if (!res.ok) {
			setSaveState(key, 'idle');
			await invalidateAll();
			return;
		}
		flashSaved(key);
		// Be om reload slik at ny kopi vises på riktig dag (kan være neste uke).
		await invalidateAll();
	}

	function startTouchDrag(event: TouchEvent, checklistId: string, itemId: string) {
		event.preventDefault();
		dragItem = { checklistId, itemId };
		dragOverItemId = null;

		function onMove(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			if (!touch) return;
			const el = document.elementFromPoint(touch.clientX, touch.clientY);
			const row = el?.closest('[data-item-id]') as HTMLElement | null;
			dragOverItemId = row?.dataset.itemId ?? null;
		}

		function onEnd() {
			const src = dragItem;
			const target = dragOverItemId;
			dragItem = null;
			dragOverItemId = null;
			document.removeEventListener('touchmove', onMove);
			if (src && target && target !== src.itemId) {
				void reorderChecklistItems(src.checklistId, src.itemId, target);
			}
		}

		document.addEventListener('touchmove', onMove, { passive: false });
		document.addEventListener('touchend', onEnd, { once: true });
	}

	function handleEditBlur() {
		if (skipEditBlur) {
			skipEditBlur = false;
			return;
		}

		void saveEditedItem();
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void saveEditedItem();
			return;
		}

		if (event.key === 'Escape') {
			editingItem = null;
		}
	}

	async function submitWeekComposer() {
		if (!weekChecklistState) return;
		await createChecklistItem(weekChecklistState.id, weekComposerText, 1);
		weekComposerText = '';
		await tick();
		weekComposerInput?.focus();
	}

	async function submitDayComposer() {
		const checklist = await ensureDayChecklist(selectedDayIso);
		if (!checklist) return;
		await createChecklistItem(checklist.id, dayComposerText, 1);
		dayComposerText = '';
		await tick();
		dayComposerInput?.focus();
	}

	async function ensureDayChecklist(dayIso: string) {
		const existing = dayChecklistsState[dayIso];
		if (existing) return existing;
		const weekKey = getIsoWeekDashedFromIsoDate(dayIso);

		const response = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `Dag ${dayIso}`,
				emoji: '☑️',
				context: `week:${weekKey}:day:${dayIso}`
			})
		});

		if (!response.ok) return null;

		const created = await response.json() as DayChecklist;
		dayChecklistsState = {
			...dayChecklistsState,
			[dayIso]: {
				id: created.id,
				title: created.title,
				completedAt: created.completedAt,
				items: created.items ?? []
			}
		};

		return dayChecklistsState[dayIso];
	}

	async function closeSelectedDay(mode: 'unsolved' | 'carryover') {
		if (!selectedDayChecklist || dayCloseBusy) return;
		if (nudgeTrack === 'close_day') {
			await reportNudgeStage('flow_started');
		}
		const sourceChecklist = selectedDayChecklist;
		const openItems = sourceChecklist.items.filter((item) => !item.checked);

		dayCloseBusy = true;
		dayCloseMessage = '';

		if (mode === 'carryover' && openItems.length > 0) {
			const nextDayIso = addDaysIsoDate(selectedDayIso, 1);
			const targetChecklist = await ensureDayChecklist(nextDayIso);
			if (!targetChecklist) {
				dayCloseBusy = false;
				dayCloseMessage = 'Kunne ikke opprette neste dagsliste.';
				return;
			}

			const existingTexts = new Set(
				(targetChecklist.items ?? []).map((item) => item.text.trim().toLowerCase())
			);
			const itemsToCarry = openItems
				.map((item) => item.text.trim())
				.filter((text) => text.length > 0)
				.filter((text) => !existingTexts.has(text.toLowerCase()));

			if (itemsToCarry.length > 0) {
				await appendChecklistItems(targetChecklist.id, itemsToCarry);
			}
		}

		const closed = await setChecklistCompleted(sourceChecklist.id, true);
		dayCloseBusy = false;
		if (!closed) {
			dayCloseMessage = 'Kunne ikke avslutte dagen.';
			return;
		}

		dayCloseMessage = mode === 'carryover'
			? 'Dag avsluttet. Åpne punkter er tatt med til neste dag.'
			: 'Dag avsluttet. Åpne punkter ble stående som uløste.';
		flashSaved('dayItems');
		if (nudgeTrack === 'close_day') {
			await reportNudgeStage('flow_completed');
		}
	}

	async function planNextDayFromClose() {
		const nextDayIso = addDaysIsoDate(selectedDayIso, 1);
		setSelectedDay(nextDayIso);
		await tick();
		await openDayPlanSheet();
	}

	function openDayCloseFlow() {
		if (!selectedDayChecklist) return;
		const openItems = selectedDayChecklist.items.filter((item) => !item.checked);
		const decisions: Record<string, 'carryover' | 'unsolved'> = {};
		for (const item of openItems) decisions[item.id] = 'unsolved';
		dayCloseDecisions = decisions;
		dayCloseFlowOpen = true;
	}

	function toggleCloseDecision(itemId: string) {
		dayCloseDecisions = {
			...dayCloseDecisions,
			[itemId]: dayCloseDecisions[itemId] === 'carryover' ? 'unsolved' : 'carryover'
		};
	}

	async function applyDayCloseFlow(andPlanNext = false) {
		if (!selectedDayChecklist || dayCloseBusy) return;
		if (nudgeTrack === 'close_day') await reportNudgeStage('flow_started');

		dayCloseBusy = true;
		dayCloseFlowOpen = false;
		dayCloseMessage = '';

		const openItems = selectedDayChecklist.items.filter((item) => !item.checked);
		const carryItems = openItems.filter((item) => dayCloseDecisions[item.id] === 'carryover');

		if (carryItems.length > 0) {
			const nextDayIso = addDaysIsoDate(selectedDayIso, 1);
			const targetChecklist = await ensureDayChecklist(nextDayIso);
			if (targetChecklist) {
				const existingTexts = new Set(
					(targetChecklist.items ?? []).map((item) => item.text.trim().toLowerCase())
				);
				const toCarry = carryItems
					.map((item) => item.text.trim())
					.filter((text) => text.length > 0 && !existingTexts.has(text.toLowerCase()));
				if (toCarry.length > 0) await appendChecklistItems(targetChecklist.id, toCarry);
			}
		}

		const closed = await setChecklistCompleted(selectedDayChecklist.id, true);
		dayCloseBusy = false;
		if (!closed) { dayCloseMessage = 'Kunne ikke avslutte dagen.'; return; }

		dayCloseMessage = carryItems.length > 0
			? `Dag avsluttet. ${carryItems.length} punkt tatt med til neste dag.`
			: 'Dag avsluttet.';
		flashSaved('dayItems');
		if (nudgeTrack === 'close_day') await reportNudgeStage('flow_completed');

		if (andPlanNext) await planNextDayFromClose();
	}

	async function openWeekPlanFlow() {
		openingWeekPlanFlow = true;
		try {
			const res = await fetch(`/api/week-plan/context?week=${encodeURIComponent(data.week.dashedKey)}`);
			if (!res.ok) return;
			const ctx = await res.json() as {
				currentWeekKey: string;
				currentWeekNo: number;
				prevWeekKey: string;
				prevWeekNo: number;
				note: string;
				reflection: string;
				uncheckedItems: Array<{ id: string; text: string }>;
				weekGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
				recurringTasks: string[];
			};

			const goalLines = ctx.weekGoals.map((g) => {
				const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
				const pctStr = pct !== null ? ` (${pct}%)` : '';
				return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pctStr}`;
			}).join('\n');

			const longTermLines = data.longTermGoals.map((g) => {
				const deadline = g.targetDate ? ` (frist: ${new Date(g.targetDate).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })})` : '';
				return `- "${g.title}"${deadline}`;
			}).join('\n');

			const refleksjonPrompt = [
				`Brukeren er klar for å planlegge uke ${ctx.currentWeekNo}.`,
				`\nForrige uke (uke ${ctx.prevWeekNo}):`,
				ctx.note ? `Ukesnotat: "${ctx.note}"` : '',
				ctx.reflection ? `Refleksjon: "${ctx.reflection}"` : '',
				goalLines ? `\nMål:\n${goalLines}` : '',
				'\nGi en kort, varm oppsummering av forrige uke (2-3 setninger). Avslutt med ett åpent spørsmål om hva som gikk bra og hva som var utfordrende.'
			].filter(Boolean).join('\n');

			const maalPrompt = [
				`Du hjelper brukeren å sette ukesmål for uke ${ctx.currentWeekNo}.`,
				goalLines ? `\nForrige ukes mål og fremgang (uke ${ctx.prevWeekNo}):\n${goalLines}` : '\nIngen mål fra forrige uke.',
				longTermLines ? `\nOverordnede mål å forankre i:\n${longTermLines}` : '',
				'\nSkille mellom mål og oppgaver:',
				'- UKESMÅL: kun for ting med målbar fremdrift mot et tall (f.eks. løping i km, antall treningsøkter, vekt i kg). Hold listen kort.',
				'- UKESOPPGAVER: konkrete ting du gjør 1–7 ganger denne uka (handle, planleggingsprat, sjekke noe, møte osv.).',
				'\nGå gjennom forrige ukes mål. Foreslå om hvert bør videreføres eller justeres. Kom gjerne med nye oppgaver basert på refleksjonen.',
				'\nAvslutt alltid med begge listene (utelat seksjoner som ikke passer):',
				'\nUKESMÅL:',
				'- [tittel]: [verdi] [enhet]',
				'\nUKESOPPGAVER:',
				'- [tittel]: [antall] [enhet]'
			].filter(Boolean).join('\n');

			const ukeshistoriePrompt = [
				`Du hjelper brukeren å skrive en kort ukesbeskrivelse for uke ${ctx.currentWeekNo}.`,
				`Spør: "Hva handler uke ${ctx.currentWeekNo} om for deg?"`,
				'Basert på svaret, skriv et kort utkast (1-2 setninger). Vær personlig og konkret.',
				'La brukeren justere utkastet via chat. Avslutt med det endelige notatet.'
			].join('\n');

			weekPlanFlowContext = {
				weekKey: ctx.currentWeekKey,
				openItems: ctx.uncheckedItems,
				weekTasks: ctx.recurringTasks,
				prevWeekData: {
					weekNo: ctx.prevWeekNo,
					note: ctx.note,
					reflection: ctx.reflection,
					uncheckedItems: ctx.uncheckedItems,
					weekGoals: ctx.weekGoals,
					recurringTasks: ctx.recurringTasks
				},
				systemPrompts: {
					refleksjon: refleksjonPrompt,
					maal: maalPrompt,
					ukeshistorie: ukeshistoriePrompt
				}
			};
			weekPlanFlowOpen = true;
		} finally {
			openingWeekPlanFlow = false;
		}
	}

	function clampPct(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, Math.round(value)));
	}

	function toWeightGoalVisual(progress: GoalReminder['sensorProgress']) {
		if (!progress || progress.kind !== 'weight_change') return null;

		const totalDelta = Math.abs(progress.targetWeight - progress.startWeight);
		const achievedDelta = Math.abs(progress.currentWeight - progress.startWeight);
		const expectedDelta = Math.abs(progress.expectedWeight - progress.startWeight);
		const metricPct = totalDelta > 0 ? (achievedDelta / totalDelta) * 100 : 0;
		const timePct = totalDelta > 0 ? (expectedDelta / totalDelta) * 100 : 0;

		return {
			timePct: clampPct(timePct),
			metricPct: clampPct(metricPct),
			status: progress.status,
			leftLabel: `${progress.currentWeight} kg`,
			rightLabel: `mål ${progress.targetWeight} kg`
		};
	}

	async function ensureWeekChecklist() {
		if (weekChecklistState) return weekChecklistState;

		const response = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `Uke ${data.week.week}`,
				emoji: '🗓️',
				context: data.week.contextKey
			})
		});

		if (!response.ok) return null;

		const created = await response.json() as WeekChecklist;
		weekChecklistState = {
			id: created.id,
			title: created.title,
			emoji: created.emoji,
			completedAt: created.completedAt,
			items: created.items ?? []
		};

		return weekChecklistState;
	}

	async function importFromPreviousWeek() {
		const suggestions = [...data.previousWeekSummary.carryoverItems, ...data.previousWeekSummary.incompleteTasks]
			.map((text) => text.trim())
			.filter((text) => text.length > 0);
		if (suggestions.length === 0) return;

		const checklist = await ensureWeekChecklist();
		if (!checklist) return;

		planningImportBusy = true;
		const existingTexts = new Set((checklist.items ?? []).map((item) => item.text.trim().toLowerCase()));
		for (const text of suggestions) {
			if (existingTexts.has(text.toLowerCase())) continue;
			await createChecklistItem(checklist.id, text, 1);
			existingTexts.add(text.toLowerCase());
		}
		planningImportBusy = false;
	}

	async function saveDayHeadline() {
		const dayIso = selectedDayIso;
		const headline = dayHeadlinesState[dayIso] ?? '';
		setSaveState('dayNote', 'saving');

		const form = new FormData();
		form.set('weekKey', data.week.dashedKey);
		form.set('dayIso', dayIso);
		form.set('headline', headline);

		const response = await fetch('?/saveDayHeadline', {
			method: 'POST',
			body: form
		});

		if (!response.ok) {
			setSaveState('dayNote', 'idle');
			return;
		}

		flashSaved('dayNote');
	}

	async function saveWeekReview() {
		setSaveState('weekReview', 'saving');

		const form = new FormData();
		form.set('weekKey', data.week.dashedKey);
		form.set('reflection', reflectionValue);
		form.set('vision', visionValue);

		const response = await fetch('?/saveNotes', {
			method: 'POST',
			body: form
		});

		if (!response.ok) {
			setSaveState('weekReview', 'idle');
			return;
		}

		flashSaved('weekReview');
	}

	function handleComposerKeydown(event: KeyboardEvent, scope: 'week' | 'day') {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void (scope === 'week' ? submitWeekComposer() : submitDayComposer());
	}
</script>

<svelte:head>
	<title>Ukeplan</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" theme="dark" surface="default">
	<PullToRefresh excludeSelectors=".wp-header-actions, .wp-calendar-wrap">
	<div class="week-plan-page">
	<header class="wp-header">
		<ScreenTitle
			title={`Uke ${data.week.week}`}
			ariaLabel="Tilbake til hjem"
			onpress={() => { startNavMetric('ukeplan', 'home'); void goto('/'); }}
		/>
		<div class="wp-header-actions">
			{#each data.activeTrips as trip}
				<a class="wp-calendar-btn" href="/tema/{trip.id}" aria-label={trip.name}>
					{trip.emoji ?? '🗺️'}
				</a>
			{/each}
			<a
				class="wp-calendar-btn wp-month-btn"
				href={`/maanedsplan?month=${selectedDayIso.slice(0, 7)}`}
				aria-label="Til månedsplan"
				title="Månedsplan"
			>Mnd</a>
			<div class="wp-calendar-wrap">
				<button
					class="wp-calendar-btn"
					type="button"
					aria-label="Velg uke"
					onclick={() => weekPickerInput?.showPicker?.()}
				><Icon name="calendar" size={18} /></button>
				<input
					bind:this={weekPickerInput}
					type="date"
					class="wp-week-picker-input"
					value={data.week.days[0].isoDate}
					onchange={(event) => {
						const val = (event.currentTarget as HTMLInputElement).value;
						if (val) void goto(weekHref(getIsoWeekDashedFromIsoDate(val)));
					}}
				/>
			</div>
		</div>
	</header>

	{#if showPlanWeek || showPlanDay || showCloseDay || hasCarryovers}
	<div class="wp-action-ribbon">
		{#if showPlanWeek}
			<button class="wp-flow-btn wp-flow-btn--week" type="button" onclick={() => void openWeekPlanFlow()} disabled={openingWeekPlanFlow}>
				<span class="wp-flow-btn-icon">{openingWeekPlanFlow ? '⏳' : '🗓️'}</span>
				<span class="wp-flow-btn-label">{openingWeekPlanFlow ? 'Henter …' : 'Planlegg uka'}</span>
			</button>
		{/if}
		{#if hasCarryovers && !weekIsPlanned}
			<button class="wp-flow-btn wp-flow-btn--util" type="button" onclick={() => void importFromPreviousWeek()} disabled={planningImportBusy}>
				<span class="wp-flow-btn-icon">{planningImportBusy ? '⏳' : '↩️'}</span>
				<span class="wp-flow-btn-label">{planningImportBusy ? 'Legger til …' : 'Importer forrige uke'}</span>
			</button>
		{/if}
		{#if showPlanDay}
			<button class="wp-flow-btn wp-flow-btn--day" type="button" onclick={() => void openDayPlanSheet()} disabled={dayPlanSheetBusy}>
				<span class="wp-flow-btn-icon">{dayPlanSheetBusy ? '⏳' : '📋'}</span>
				<span class="wp-flow-btn-label">{dayPlanSheetBusy ? 'Henter …' : 'Planlegg dag'}</span>
				<span class="wp-flow-btn-sub">{smartDayLabel(selectedDayIso)}</span>
			</button>
		{/if}
		{#if showCloseDay}
			<button class="wp-flow-btn wp-flow-btn--day wp-flow-btn--close" type="button" onclick={openDayCloseFlow} disabled={dayCloseBusy}>
				<span class="wp-flow-btn-icon">{dayCloseBusy ? '⏳' : '✅'}</span>
				<span class="wp-flow-btn-label">{dayCloseBusy ? 'Jobber …' : 'Avslutt dag'}</span>
				<span class="wp-flow-btn-sub">{smartDayLabel(selectedDayIso)}</span>
			</button>
		{/if}
	</div>
	{/if}



	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Ukesnotat</h2>
		</div>
		<form method="POST" action="?/saveWeekNote" class="wp-notes-form" use:enhance={autosaveEnhance('weekNote')} data-allow-empty-autosave="true">
			<input type="hidden" name="weekKey" value={data.week.dashedKey} />
			<div class="wp-field-shell">
				<textarea
					id="weekNote"
					name="weekNote"
					class="wp-textarea wp-textarea-note"
					bind:value={weekNoteValue}
					rows="2"
					placeholder="Ferien er over og vi skal tilbake til jobb, skole og barnehage."
					onfocus={markInitialValue}
					onblur={submitOnBlurIfChanged}
				>{data.weekNote}</textarea>
				<span class="wp-save-dot" class:is-saving={saveStates.weekNote === 'saving'} class:is-saved={saveStates.weekNote === 'saved'} aria-hidden="true"></span>
			</div>
		</form>
	</section>

	<section class="wp-card" id="ukeplan-checklist">
		<div class="wp-card-head">
			<h2>Ukas oppgaver</h2>
			{#if weekChecklistState}
				<span class="wp-pill">{data.weekTasks.length + progress.total} totalt</span>
			{:else}
				<span class="wp-pill">{data.weekTasks.length} fra tema/mål</span>
			{/if}
		</div>

		{#if data.weekTasks.length > 0}
			<ul class="wp-task-list">
				{#each data.weekTasks as task}
					{@const structuredMeta = formatStructuredTaskMeta(task)}
					{@const intentBadge = getTaskIntentBadge(task)}
					{@const intentFailureReason = getTaskIntentFailureReasonLabel(task)}
					{@const evaluationLabel = getTaskEvaluationLabel(task)}
					<li
						class="wp-task"
						onpointerdown={(e) => handleTaskPressStart(e, task)}
						onpointerup={handleTaskPressEnd}
						onpointercancel={handleTaskPressEnd}
						onpointerleave={handleTaskPressEnd}
					>
						<div class="wp-task-main">
							<div>
								{#if editingTask?.taskId === task.id}
									<div class="wp-edit-shell">
										<MentionPicker
											bind:this={taskMentionPickerEl}
											visible={taskMention.visible}
											persons={taskMention.filtered}
											anchorEl={editTaskInput}
											onSelect={(p) => {
												if (!editTaskInput || !editingTask) return;
												taskMention.insert(
													p.name,
													() => editTaskInput!.value,
													() => editTaskInput!.selectionStart ?? editTaskInput!.value.length,
													(v) => { editingTask!.title = v; },
													(pos) => tick().then(() => editTaskInput?.setSelectionRange(pos, pos))
												);
											}}
											onClose={() => taskMention.close()}
										/>
										<input
											bind:this={editTaskInput}
											class="wp-task-edit-input"
											type="text"
											bind:value={editingTask.title}
											oninput={(e) => {
												const el = e.currentTarget as HTMLInputElement;
												taskMention.scan(el.value, el.selectionStart ?? el.value.length);
											}}
											onkeydown={(e) => {
												if (taskMention.visible && taskMentionPickerEl?.handleKeydown(e)) return;
												if (e.key === 'Enter') void saveEditTask();
												if (e.key === 'Escape') editingTask = null;
											}}
											onblur={() => void saveEditTask()}
										/>
										<button
											type="button"
											class="btn-icon-danger"
											onmousedown={() => (skipEditTask = true)}
											onclick={() => void deleteTask(task.id)}
											aria-label="Slett oppgave"
										><Icon name="close" size={13} /></button>
									</div>
								{:else}
									<div class="wp-task-title-row">
										<button
											type="button"
											class="wp-task-title-btn"
											class:done={doneTask(task)}
											onclick={() => { if (!taskLongPressTriggered) editingTask = { taskId: task.id, title: task.title, originalTitle: task.title }; }}
										>{task.title}</button>
										{#if procedureMatches.has(task.id)}
											{@const match = procedureMatches.get(task.id)!}
											<ProcedureBadge
												emoji={match.emoji}
												title={match.title}
												onclick={() => openProcedureSheet(match.procedureId)}
											/>
										{/if}
									</div>
								{/if}
								<p class="wp-task-meta">
									{task.goalTitle ?? 'Uten mål'}
									{#if task.themeName} · {task.themeName}{/if}
									{#if structuredMeta} · {structuredMeta}{/if}
								</p>
								{#if intentBadge}
									<div class={`wp-task-intent-pill wp-task-intent-${intentBadge.tone}`}>{intentBadge.label}</div>
								{/if}
								{#if evaluationLabel}
									<div class="wp-task-evaluation">{evaluationLabel}</div>
								{/if}
								{#if intentFailureReason}
									<div class="wp-task-intent-failure-reason">{intentFailureReason}</div>
								{/if}
							</div>
							<div class="wp-slot-row" aria-label="Progresjon">
								{#each Array.from({ length: task.repeatCount }) as _, index}
									<span class="wp-slot" class:checked={slotState(task, index)}>{slotState(task, index) ? '✓' : ''}</span>
								{/each}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if weekChecklistState}
			{@const weekChecklistId = weekChecklistState.id}
			<div class="wp-progress-track" aria-hidden="true">
				<div class="wp-progress-fill" style={`width:${progress.pct}%`}></div>
			</div>

			<ul class="wp-checklist">
				{#each groupChecklistItems(sortByStatus(weekChecklistState.items.filter(i => !i.parentId))) as group}
					{#if group.type === 'group'}
						<li class="wp-check-row">
							<div class="wp-check-row-main">
								<span class="wp-check-text wp-check-group-label">{activityEmoji(group.label) ? activityEmoji(group.label) + " " : ""}{group.label}</span>
								<div class="wp-slot-row" aria-label="Progresjon">
									{#each group.items as item}
										<button
											type="button"
											class="wp-slot wp-slot-btn"
											class:checked={item.checked}
											onclick={() => void toggleChecklistItem(weekChecklistId, item.id, !item.checked)}
											aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
										>{item.checked ? '✓' : ''}</button>
									{/each}
								</div>
							</div>
						</li>
					{:else}
					{@const weekChildren = sortByStatus(weekChecklistState.items.filter(c => c.parentId === group.item.id))}
					{@const hasWeekChildren = weekChildren.length > 0}
					{@const completedWeekChildren = weekChildren.filter(c => c.checked).length}
					{@const isWeekExpanded = expandedWeekParentIds.has(group.item.id)}
					{@const wR = 8}
					{@const wC = 2 * Math.PI * wR}
					{@const wPct = weekChildren.length > 0 ? completedWeekChildren / weekChildren.length : 0}
					<li
						class="wp-check-row"
						class:wp-check-row-parent={hasWeekChildren}
						class:is-dragging={dragItem?.itemId === group.item.id}
						class:is-drag-over={dragOverItemId === group.item.id && dragItem?.itemId !== group.item.id}
						data-item-id={group.item.id}
						draggable={editingItem?.itemId !== group.item.id}
						ondragstart={() => (dragItem = { checklistId: weekChecklistId, itemId: group.item.id })}
						ondragover={(event) => { event.preventDefault(); dragOverItemId = group.item.id; }}
						ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dragOverItemId = null; }}
						ondrop={() => {
							if (!dragItem) return;
							void reorderChecklistItems(weekChecklistId, dragItem.itemId, group.item.id);
							dragItem = null;
							dragOverItemId = null;
						}}
						ondragend={() => { dragItem = null; dragOverItemId = null; }}
					>
						<div class="wp-check-row-main">
							{#if editingItem?.itemId === group.item.id}
								<div class="wp-edit-shell">
									<input
										bind:this={editInput}
										bind:value={editingItem.text}
										class="wp-input wp-edit-input"
										onblur={handleEditBlur}
										onkeydown={handleEditKeydown}
									/>
									<button
										type="button"
										class="btn-icon-danger"
										onmousedown={() => (skipEditBlur = true)}
										onclick={() => void deleteChecklistItem(weekChecklistId, group.item.id)}
										aria-label="Slett punkt"
									><Icon name="close" size={13} /></button>
								</div>
							{:else}
								<button
									type="button"
									class="wp-item-text-btn"
									class:is-skipped={!!group.item.skippedAt}
									onpointerdown={(e) => handleContextPressStart(e, weekChecklistId, group.item)}
									onpointerup={handleContextPressEnd}
									onpointercancel={handleContextPressEnd}
									onpointerleave={handleContextPressEnd}
									onclick={() => handleEditPress(weekChecklistId, group.item)}
								>
									<span class="wp-check-text" class:checked={group.item.checked} class:skipped={!!group.item.skippedAt}>{group.item.text}</span>
								</button>
							{/if}
							<div class="wp-check-row-right">
								{#if group.item.domain === 'food' && editingItem?.itemId !== group.item.id}
									<button
										type="button"
										class="wp-food-affordance"
										onclick={() => openFoodChatForItem(group.item.text)}
										aria-label="Planlegg måltid"
										title="Planlegg måltid"
									>🍽️</button>
								{/if}
								{#if hasWeekChildren}
									{#if completedWeekChildren === weekChildren.length}
										<span class="wp-check-circle checked">✓</span>
									{:else}
										<svg class="wp-week-parent-circle" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
											<circle cx="10" cy="10" r={wR} fill="none" stroke="#353c50" stroke-width="2"/>
											<circle cx="10" cy="10" r={wR} fill="none"
												stroke="#7c8ef5"
												stroke-width="2"
												stroke-dasharray="{wPct * wC} {wC}"
												stroke-linecap="round"
												transform="rotate(-90 10 10)"
											/>
										</svg>
									{/if}
									<button
										type="button"
										class="wp-parent-caret"
										class:expanded={isWeekExpanded}
										onclick={() => toggleWeekParentExpansion(group.item.id)}
										aria-label={isWeekExpanded ? 'Lukk subitems' : 'Utvid subitems'}
									>▸</button>
								{:else}
									<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(weekChecklistId, group.item.id, !group.item.checked)} aria-label="Toggle">
										<span class="wp-check-circle" class:checked={group.item.checked} class:skipped={!!group.item.skippedAt}>{group.item.skippedAt ? '✕' : group.item.checked ? '✓' : ''}</span>
									</button>
								{/if}
								<span class="wp-drag-handle" aria-hidden="true" ontouchstart={(event) => startTouchDrag(event, weekChecklistId, group.item.id)}>⋮⋮</span>
							</div>
						</div>
						{#if hasWeekChildren && isWeekExpanded}
							<div class="wp-day-children">
								{#each weekChildren as child}
									<div class="wp-day-child-row">
										{#if editingItem?.itemId === child.id}
											<div class="wp-edit-shell">
												<input
													bind:this={editInput}
													bind:value={editingItem.text}
													class="wp-input wp-edit-input"
													onblur={handleEditBlur}
													onkeydown={handleEditKeydown}
												/>
												<button
													type="button"
													class="btn-icon-danger"
													onmousedown={() => (skipEditBlur = true)}
													onclick={() => void deleteChecklistItem(weekChecklistId, child.id)}
													aria-label="Slett subpunkt"
												><Icon name="close" size={13} /></button>
											</div>
										{:else}
											<button
												type="button"
												class="wp-item-text-btn"
												class:is-skipped={!!child.skippedAt}
												onpointerdown={(e) => handleContextPressStart(e, weekChecklistId, child)}
												onpointerup={handleContextPressEnd}
												onpointercancel={handleContextPressEnd}
												onpointerleave={handleContextPressEnd}
												onclick={() => handleEditPress(weekChecklistId, child)}
											>
												<span class="wp-check-text" class:checked={child.checked} class:skipped={!!child.skippedAt}>{child.text}</span>
											</button>
											<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(weekChecklistId, child.id, !child.checked)} aria-label="Toggle">
												<span class="wp-check-circle" class:checked={child.checked} class:skipped={!!child.skippedAt}>{child.skippedAt ? '✕' : child.checked ? '✓' : ''}</span>
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</li>
				{/if}
				{/each}
			</ul>

			<div class="wp-add-form">
				<div class="wp-field-shell">
					<input
						bind:this={weekComposerInput}
						bind:value={weekComposerText}
						class="wp-input"
						type="text"
						placeholder="Skriv punkt og trykk Enter"
						onkeydown={(event) => handleComposerKeydown(event, 'week')}
					/>
					<span class="wp-save-dot" class:is-saving={saveStates.weekItems === 'saving'} class:is-saved={saveStates.weekItems === 'saved'} aria-hidden="true"></span>
				</div>
			</div>
		{:else}
			<form method="POST" action="?/createChecklistForWeek">
				<input type="hidden" name="weekKey" value={data.week.dashedKey} />
				<button class="btn-secondary" type="submit">Opprett ukeliste</button>
			</form>
		{/if}
		{#if data.weekChecklist?.planConversationId}
			<a href="/samtaler?conversation={data.weekChecklist.planConversationId}" class="wp-plan-conv-link">Åpne planleggingssamtalen →</a>
		{/if}
		{#if weekPlanJustCompleted}
			<div class="wp-completion-banner">
				<span>Ukeplanen er klar! 🎉</span>
				<div class="wp-completion-banner-actions">
					<a href="#ukeplan-checklist" class="wp-completion-banner-btn" onclick={() => weekPlanJustCompleted = false}>Åpne ukeplanen</a>
					<button type="button" class="wp-completion-banner-btn" onclick={() => weekPlanJustCompleted = false}>Lukk</button>
				</div>
			</div>
		{/if}
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Dager og dagsmål</h2>
		</div>

		<div class="wp-days" aria-label="Ukas dager">
			{#each data.week.days as day}
				{@const tripEmoji = tripDayEmoji[day.isoDate]}
				{@const wx = tripDayWeather[day.isoDate]}
				{@const homeWx = homeDayWeather[day.isoDate]}
				<button
					type="button"
					class="wp-day-btn"
					class:today={day.isoDate === todayIso}
					class:selected={selectedDayIso === day.isoDate}
					class:on-trip={!!tripEmoji}
					onclick={() => setSelectedDay(day.isoDate)}
				>
					{#if tripEmoji && !wx}
						<span class="wp-day-trip-emoji" aria-label="På tur">{tripEmoji}</span>
					{/if}
					{#if wx}
						<span class="wp-day-wx" aria-label="Vær">
							<span class="wp-day-wx-sym">{metSymbolToEmoji(wx.symbol)}</span><span class="wp-day-wx-temp">{wx.tempMax}°</span>
						</span>
					{:else if homeWx}
						<span class="wp-day-wx" aria-label="Vær">
							<span class="wp-day-wx-sym">{homeWx.emoji}</span><span class="wp-day-wx-temp">{homeWx.tempMax}°</span>
						</span>
					{/if}
					<span class="wp-day-label">{smartDayLabel(day.isoDate)}</span>
					<span class="wp-day-number">{day.day}</span>
				</button>
			{/each}
		</div>

		<div class="wp-notes-form">
			{#if selectedDaySpondEvents.length > 0}
				<ul class="wp-spond-list">
					{#each selectedDaySpondEvents as event}
						{@const start = new Date(event.startTimestamp)}
						{@const timeStr = start.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
						{@const href = event.spondEventId ? `https://spond.com/client/sponds/${event.spondEventId}` : null}
						<li class="wp-spond-item" class:cancelled={event.cancelled} data-rsvp={event.rsvp}>
							<span class="wp-spond-dot" aria-hidden="true"></span>
							<span class="wp-spond-time">{timeStr}</span>
							{#if href}
								<a class="wp-spond-name" {href} target="_blank" rel="noopener noreferrer">{event.name}</a>
							{:else}
								<span class="wp-spond-name">{event.name}</span>
							{/if}
							{#if event.rsvp === 'unanswered'}
								<span class="wp-spond-rsvp wp-spond-rsvp--pending" title="Ikke svart">?</span>
							{:else if event.rsvp === 'declined'}
								<span class="wp-spond-rsvp wp-spond-rsvp--declined" title="Takket nei">✗</span>
							{/if}
							{#if event.groupName}
								<span class="wp-spond-group">{event.groupName}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<div class="wp-field-shell">
				<textarea
					class="wp-textarea"
					rows="2"
					placeholder={`Liten plan for ${smartDayLabel(selectedDayIso)}...`}
					value={selectedDayHeadline}
					oninput={(event) => {
						const target = event.currentTarget as HTMLTextAreaElement;
						dayHeadlinesState = { ...dayHeadlinesState, [selectedDayIso]: target.value };
					}}
					onfocus={markInitialValue}
					onblur={async (event) => {
						submitOnBlurIfChanged(event);
						await saveDayHeadline();
					}}
				></textarea>
				<span class="wp-save-dot" class:is-saving={saveStates.dayNote === 'saving'} class:is-saved={saveStates.dayNote === 'saved'} aria-hidden="true"></span>
			</div>
		</div>

		{#if dayCloseMessage}
			<p class="wp-helper">{dayCloseMessage}</p>
		{/if}

		{#if selectedDayChecklist}
			<ul class="wp-checklist">
				{#each sortedDayItems as item}
					{@const dayChildren = sortByStatus(sortByTime(selectedDayChecklist.items.filter((child) => child.parentId === item.id)))}
					{@const hasChildren = dayChildren.length > 0}
					{@const isExpanded = expandedDayParentIds.has(item.id)}
					{@const completedChildren = dayChildren.filter((child) => child.checked).length}
					<li
						class="wp-check-row"
						class:wp-check-row-parent={hasChildren}
						class:is-dragging={dragItem?.itemId === item.id}
						class:is-drag-over={dragOverItemId === item.id && dragItem?.itemId !== item.id}
						data-item-id={item.id}
						draggable={editingItem?.itemId !== item.id}
						ondragstart={() => (dragItem = { checklistId: selectedDayChecklist.id, itemId: item.id })}
						ondragover={(event) => { event.preventDefault(); dragOverItemId = item.id; }}
						ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dragOverItemId = null; }}
						ondrop={() => {
							if (!dragItem) return;
							void reorderChecklistItems(selectedDayChecklist.id, dragItem.itemId, item.id);
							dragItem = null;
							dragOverItemId = null;
						}}
						ondragend={() => { dragItem = null; dragOverItemId = null; }}
					>
						<div class="wp-check-row-main">
							{#if editingItem?.itemId === item.id}
								<div class="wp-edit-shell">
									<input
										bind:this={editInput}
										bind:value={editingItem.text}
										class="wp-input wp-edit-input"
										onblur={handleEditBlur}
										onkeydown={handleEditKeydown}
									/>
									<button
										type="button"
										class="btn-icon-danger"
										onmousedown={() => (skipEditBlur = true)}
										onclick={() => void deleteChecklistItem(selectedDayChecklist.id, item.id)}
										aria-label="Slett punkt"
									><Icon name="close" size={13} /></button>
								</div>
							{:else}
								<button
									type="button"
									class="wp-item-text-btn"
									class:is-skipped={!!item.skippedAt}
									onpointerdown={(e) => handleContextPressStart(e, selectedDayChecklist.id, item)}
									onpointerup={handleContextPressEnd}
									onpointercancel={handleContextPressEnd}
									onpointerleave={handleContextPressEnd}
									onclick={() => handleEditPress(selectedDayChecklist.id, item)}
								>
									{#if hasChildren}
										<span class="wp-parent-progress">{completedChildren}/{dayChildren.length}</span>
									{/if}
									{#if item.metadata?.timeHour !== undefined}
										<span class="wp-time-badge">{formatItemTime(item.metadata.timeHour, item.metadata.timeMinute ?? 0)}</span>
									{/if}
									<span class="wp-check-text" class:checked={item.checked} class:skipped={!!item.skippedAt}>{item.metadata?.timeHour !== undefined ? stripTimeFromText(item.text) : item.text}</span>
									{#if item.metadata?.linkedTaskId}
										<span class="wp-intent-badge" title="Koblet til ukesmål: {item.metadata.linkedTaskTitle ?? ''}">
											{item.metadata.autoChecked ? '⚡' : '🔗'}
											{item.metadata.linkedTaskTitle
												? item.metadata.linkedTaskTitle.slice(0, 24) + (item.metadata.linkedTaskTitle.length > 24 ? '…' : '')
												: 'Ukesmål'}
										</span>
									{/if}
								</button>
							{/if}
							<div class="wp-check-row-right">
								{#if hasChildren}
									<button
										type="button"
										class="wp-parent-caret"
										class:expanded={isExpanded}
										onclick={() => toggleDayParentExpansion(item.id)}
										aria-label={isExpanded ? 'Lukk subitems' : 'Utvid subitems'}
									>▸</button>
								{:else}
									<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(selectedDayChecklist.id, item.id, !item.checked)} aria-label="Toggle">
										<span class="wp-check-circle" class:checked={item.checked} class:skipped={!!item.skippedAt}>{item.skippedAt ? '✕' : item.checked ? '✓' : ''}</span>
									</button>
								{/if}
								<span class="wp-drag-handle" aria-hidden="true" ontouchstart={(event) => startTouchDrag(event, selectedDayChecklist.id, item.id)}>⋮⋮</span>
							</div>
						</div>
						{#if hasChildren && isExpanded}
							<div class="wp-day-children">
								{#each dayChildren as child}
									<div class="wp-day-child-row">
										{#if editingItem?.itemId === child.id}
											<div class="wp-edit-shell">
												<input
													bind:this={editInput}
													bind:value={editingItem.text}
													class="wp-input wp-edit-input"
													onblur={handleEditBlur}
													onkeydown={handleEditKeydown}
												/>
												<button
													type="button"
													class="btn-icon-danger"
													onmousedown={() => (skipEditBlur = true)}
													onclick={() => void deleteChecklistItem(selectedDayChecklist.id, child.id)}
													aria-label="Slett subpunkt"
												><Icon name="close" size={13} /></button>
											</div>
										{:else}
											<button
												type="button"
												class="wp-item-text-btn"
												class:is-skipped={!!child.skippedAt}
												onpointerdown={(e) => handleContextPressStart(e, selectedDayChecklist.id, child)}
												onpointerup={handleContextPressEnd}
												onpointercancel={handleContextPressEnd}
												onpointerleave={handleContextPressEnd}
												onclick={() => handleEditPress(selectedDayChecklist.id, child)}
											>
												{#if child.metadata?.timeHour !== undefined}
													<span class="wp-time-badge">{formatItemTime(child.metadata.timeHour, child.metadata.timeMinute ?? 0)}</span>
												{/if}
												<span class="wp-check-text" class:checked={child.checked} class:skipped={!!child.skippedAt}>{child.metadata?.timeHour !== undefined ? stripTimeFromText(child.text) : child.text}</span>
											</button>
											<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(selectedDayChecklist.id, child.id, !child.checked)} aria-label="Toggle">
												<span class="wp-check-circle" class:checked={child.checked} class:skipped={!!child.skippedAt}>{child.skippedAt ? '✕' : child.checked ? '✓' : ''}</span>
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div class="wp-add-form">
			<div class="wp-field-shell">
				<input
					bind:this={dayComposerInput}
					bind:value={dayComposerText}
					class="wp-input"
					type="text"
					placeholder={`Ny oppgave`}
					onkeydown={(event) => handleComposerKeydown(event, 'day')}
				/>
				<span class="wp-save-dot" class:is-saving={saveStates.dayItems === 'saving'} class:is-saved={saveStates.dayItems === 'saved'} aria-hidden="true"></span>
			</div>
		</div>
	</section>

	{#if data.vision || data.longTermGoals.length > 0}
	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Målbilde og retning</h2>
		</div>

		{#if data.vision}
			<p class="wp-vision-text">{data.vision}</p>
		{/if}

		{#if data.longTermGoals.length > 0}
			<ul class="wp-reminder-list">
				{#each data.longTermGoals as goal}
					{@const progress = goal.sensorProgress}
					{@const weightVisual = toWeightGoalVisual(progress)}
					<li class="wp-reminder-row" class:has-sensor-progress={!!progress}>
						<a class="wp-reminder-link" href={`/goals?goal=${goal.id}`}>
							<div class="wp-reminder-main">
								<span class="wp-reminder-title">{goal.title}</span>
								<span class="wp-reminder-date">{formatDate(goal.targetDate)}</span>
							</div>
							{#if progress?.kind === 'running_distance'}
								{@const runPct = progress.targetKm > 0 ? clampPct((progress.currentKm / progress.targetKm) * 100) : 0}
								<div class="wp-sensor-progress">
									<MetricCard
										metricId="running_distance"
										size="M"
										data={{ current: progress.currentKm, target: progress.targetKm, expectedByNow: progress.expectedKm }}
										height={6}
										trackColor="#1a202c"
									/>
									<div class="wp-progress-meta">
										<span class="wp-progress-km">{progress.currentKm} km</span>
										<span class="wp-progress-km">av {progress.targetKm} km · {runPct}%</span>
									</div>
								</div>
							{:else if progress && weightVisual}
								<div class="wp-sensor-progress">
									<MetricCard
										metricId="weight_change"
										size="M"
										data={{ current: progress.currentWeight, target: progress.targetWeight, startDate: progress.startDate, endDate: progress.endDate, startValue: progress.startWeight, expectedByNow: progress.expectedWeight }}
										height={6}
										trackColor="#1a202c"
										formatValue={(v) => `${Math.round(v * 10) / 10} kg`}
									/>
									<div class="wp-progress-meta">
										<span class="wp-progress-km">{weightVisual.leftLabel}</span>
										<span class="wp-progress-km">{weightVisual.rightLabel}</span>
									</div>
								</div>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	{/if}
	</div>
	</PullToRefresh>
</AppPage>

{#if dayCloseFlowOpen}
	<FlowSheet
		flow={FLOWS['day_close']}
		context={{
			dayLabel: smartDayLabel(selectedDayIso),
			openItems: (selectedDayChecklist?.items ?? [])
				.filter((i) => !i.checked)
				.map((i) => ({ id: i.id, text: i.text }))
		}}
		onclose={() => (dayCloseFlowOpen = false)}
		oncomplete={async (fd) => {
			const d = fd as { decisions?: Record<string, 'carryover' | 'unsolved'> };
			if (d.decisions) dayCloseDecisions = d.decisions;
			dayCloseFlowOpen = false;
			await applyDayCloseFlow(false);
		}}
	/>
{/if}

{#if weekPlanFlowOpen}
	<FlowSheet
		flow={FLOWS['planning_week_plan']}
		context={weekPlanFlowContext}
		onclose={() => (weekPlanFlowOpen = false)}
		oncomplete={async () => {
			weekPlanFlowOpen = false;
			weekPlanJustCompleted = true;
			await invalidateAll();
		}}
	/>
{/if}

{#if foodChatOpen}
	<FlowSheet
		flow={FLOWS['food_meal_chat']}
		context={{
			systemPrompts: { chat: 'Brukeren vil planlegge et måltid fra ukeplanen. Bruk query_food, manage_meal_plan, manage_pantry og generate_shopping_list etter behov. Foreslå konkret oppskrift og handleliste.' },
			prompts: { chat: `Hjelp meg planlegge "${foodChatItemText}". Foreslå oppskrift, sjekk hva jeg har i skapet/fryseren og bygg handleliste.` }
		}}
		onclose={() => (foodChatOpen = false)}
		oncomplete={async () => {
			foodChatOpen = false;
			await invalidateAll();
		}}
	/>
{/if}

{#if dayPlanSheetOpen}
	<FlowSheet
		flow={FLOWS['day_plan']}
		context={{
			dayIso: selectedDayIso,
			dayLabel: smartDayLabel(selectedDayIso),
			weekDashedKey: data.week.dashedKey,
			carryovers: dayPlanSheetCarryovers,
			weekTasks: dayPlanSheetWeekTasks,
			existingHeadline: dayHeadlinesState[selectedDayIso] ?? ''
		}}
		onclose={() => (dayPlanSheetOpen = false)}
		oncomplete={async (fd) => {
			// Optimistically update local state so the headline is visible immediately
			const headline = fd['headline'] as string | undefined;
			if (headline) {
				dayHeadlinesState = { ...dayHeadlinesState, [selectedDayIso]: headline };
			}
			if (nudgeTrack === 'plan_day') {
				await reportNudgeStage('flow_completed');
			}
			await invalidateAll();
		}}
	/>
{/if}

<TaskContextMenu
	open={contextMenuItem !== null}
	anchor={contextMenuRect}
	itemText={contextMenuItem?.item.text ?? ''}
	hasChildren={contextMenuItem
		? (selectedDayChecklist?.items.some((i) => i.parentId === contextMenuItem!.item.id) ?? false)
			|| (weekChecklistState?.items.some((i) => i.parentId === contextMenuItem!.item.id) ?? false)
		: false}
	isSkipped={!!contextMenuItem?.item.skippedAt}
	isChecked={!!contextMenuItem?.item.checked}
	onClose={() => { contextMenuItem = null; contextMenuRect = null; }}
	onEdit={() => {
		if (contextMenuItem) void startEditing(contextMenuItem.checklistId, contextMenuItem.item);
	}}
	onBreakdown={() => {
		if (contextMenuItem) breakdownTarget = contextMenuItem;
	}}
	onSnooze={(targetDate) => {
		if (contextMenuItem) void snoozeItem(contextMenuItem.checklistId, contextMenuItem.item.id, targetDate);
	}}
	onSkip={() => {
		if (contextMenuItem) void setItemSkipped(contextMenuItem.checklistId, contextMenuItem.item.id, true);
	}}
	onUnskip={() => {
		if (contextMenuItem) void setItemSkipped(contextMenuItem.checklistId, contextMenuItem.item.id, false);
	}}
	onStartChat={async () => {
		if (!contextMenuItem) return;
		const itemText = contextMenuItem.item.text;
		const checklistId = contextMenuItem.checklistId;
		const itemId = contextMenuItem.item.id;
		contextMenuItem = null;
		contextMenuRect = null;
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

{#if breakdownTarget}
	<BreakdownModal
		itemTitle={breakdownTarget.item.text}
		onClose={() => (breakdownTarget = null)}
		onSave={handleBreakdownSave}
	/>
{/if}

<TaskContextMenu
	open={taskContextMenuItem !== null}
	anchor={taskContextMenuRect}
	itemText={taskContextMenuItem?.title ?? ''}
	onClose={() => { taskContextMenuItem = null; taskContextMenuRect = null; }}
	onStartChat={() => { if (taskContextMenuItem) handleTaskStartChat(taskContextMenuItem); }}
	onUseProcedure={taskContextMenuItem && procedureMatches.has(taskContextMenuItem.id)
		? () => { if (taskContextMenuItem) { const m = procedureMatches.get(taskContextMenuItem.id); if (m) openProcedureSheet(m.procedureId); } }
		: undefined}
/>

{#if procedureSheetData}
	<ProcedureSheet
		procedure={procedureSheetData}
		onclose={() => { procedureSheetId = null; procedureSheetData = null; }}
		onStartChat={(conversationId) => {
			procedureSheetId = null;
			procedureSheetData = null;
			if (conversationId) {
				goto(`/samtaler?id=${conversationId}`);
			} else {
				goto(`/samtaler?newChat=true&title=${encodeURIComponent(procedureSheetData?.title ?? '')}`);
			}
		}}
		onApply={async (procedureId) => {
			const dayChecklist = dayChecklistsState[selectedDayIso];
			if (!dayChecklist) return;
			await fetch(`/api/procedures/${procedureId}/apply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ checklistId: dayChecklist.id })
			});
			procedureSheetId = null;
			procedureSheetData = null;
			await invalidateAll();
		}}
	/>
{/if}

<style>
	.week-plan-page {
		min-height: 100vh;
		width: 100%;
		padding: var(--screen-title-top-pad, 34px) 20px 110px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background:
			radial-gradient(900px 480px at 100% -10%, rgba(51, 66, 122, 0.22), transparent 70%),
			linear-gradient(180deg, #060709 0%, #08090d 55%, #060709 100%);
		color: #dcdde2;
	}

	.wp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.wp-header-actions {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		flex-shrink: 0;
	}

	.wp-calendar-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.wp-calendar-btn {
		width: 34px;
		height: 34px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		border: none;
		background: #0f1118;
		color: #bac6f9;
		flex-shrink: 0;
		text-decoration: none;
		font-size: 1.1rem;
	}

	.wp-month-btn {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		border: 1px solid #1e2030;
		color: #8a99c4;
	}
	.wp-month-btn:hover { color: #bac6f9; background: #12162a; border-color: #2e3660; }

	.wp-week-picker-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
		top: 100%;
		right: 0;
	}

	.wp-days {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 6px;
	}

	.wp-day-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 8px 4px;
		border-radius: 10px;
		border: none;
		background: #0b0d13;
		cursor: pointer;
		position: relative;
	}

	.wp-day-btn.on-trip {
		border-color: #2a3a4a;
		background: #0a1018;
	}

	.wp-day-trip-emoji {
		font-size: 0.65rem;
		line-height: 1;
		margin-bottom: 1px;
	}

	.wp-day-wx {
		display: flex;
		align-items: center;
		gap: 1px;
		line-height: 1;
		margin-bottom: 1px;
	}
	.wp-day-wx-sym { font-size: 0.8rem; }
	.wp-day-wx-temp {
		font-size: 0.62rem;
		font-weight: 700;
		color: #ccc;
	}

	.wp-day-btn.today {
		border-color: #384fa7;
		background: #11172f;
	}

	.wp-day-btn.selected {
		outline: 2px solid rgba(124, 142, 245, 0.52);
		outline-offset: 0;
	}

	.wp-day-label {
		font-size: 0.72rem;
		color: #888;
	}

	.wp-weather-strip {
		display: flex;
		justify-content: center;
		padding: 4px 0 2px;
	}

	.wp-day-number {
		font-size: 0.95rem;
		color: #ddd;
		font-weight: 700;
	}

	.wp-action-ribbon {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.wp-flow-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 12px 16px;
		min-width: 88px;
		border-radius: 12px;
		border: 1px solid var(--border-color);
		background: var(--bg-card);
		color: var(--text-secondary);
		font: inherit;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.1s;
		text-align: center;
	}
	.wp-flow-btn:hover:not(:disabled) {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.05);
		transform: translateY(-1px);
	}
	.wp-flow-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.wp-flow-btn-icon {
		font-size: 1.55rem;
		line-height: 1;
	}
	.wp-flow-btn-label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}
	.wp-flow-btn-sub {
		font-size: 0.65rem;
		color: var(--text-muted, var(--text-tertiary));
		white-space: nowrap;
	}

	/* week-level: purple accent */
	.wp-flow-btn--week {
		border-color: rgba(139, 92, 246, 0.3);
	}
	.wp-flow-btn--week:hover:not(:disabled) {
		border-color: rgba(139, 92, 246, 0.65);
		background: rgba(139, 92, 246, 0.08);
		box-shadow: 0 0 14px rgba(139, 92, 246, 0.14);
	}

	/* day-level: teal accent */
	.wp-flow-btn--day {
		border-color: rgba(52, 211, 153, 0.28);
	}
	.wp-flow-btn--day:hover:not(:disabled) {
		border-color: rgba(52, 211, 153, 0.65);
		background: rgba(52, 211, 153, 0.06);
		box-shadow: 0 0 14px rgba(52, 211, 153, 0.10);
	}

	/* utility (import): amber accent */
	.wp-flow-btn--util {
		border-color: rgba(251, 191, 36, 0.28);
	}
	.wp-flow-btn--util:hover:not(:disabled) {
		border-color: rgba(251, 191, 36, 0.6);
		background: rgba(251, 191, 36, 0.06);
		box-shadow: 0 0 14px rgba(251, 191, 36, 0.10);
	}

	/* "close/done" variants get slightly bolder base border via their colour modifier */

	.wp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border: none;
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-prev-context {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-left: 10px;
		border-left: 2px solid rgba(186, 198, 249, 0.15);
	}

	.wp-suggestion-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-suggestion-item {
		font-size: 0.95rem;
		color: #aeb4c6;
		background: #0e121c;
		border: none;
		border-radius: 8px;
		padding: 7px 9px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.wp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: #ddd;
	}

	.wp-pill {
		font-size: 0.72rem;
		color: #8a90a3;
		background: #10131a;
		border: none;
		padding: 3px 8px;
		border-radius: 999px;
	}

	.wp-subhead {
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #70788f;
		font-weight: 650;
	}

	.wp-spond-list {
		margin: 0 0 0.9rem;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.wp-spond-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.22rem 0;
		font-size: 0.82rem;
		line-height: 1.3;
	}
	.wp-spond-item.cancelled {
		opacity: 0.35;
		text-decoration: line-through;
	}
	.wp-spond-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #9b8ff5;
		flex-shrink: 0;
	}
	.wp-spond-item[data-rsvp="unanswered"] .wp-spond-dot { background: #f59e0b; }
	.wp-spond-item[data-rsvp="declined"] .wp-spond-dot { background: #555; }
	.wp-spond-item[data-rsvp="accepted"] .wp-spond-dot { background: #4ade80; }
	.wp-spond-time {
		color: var(--text-tertiary);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.wp-spond-name {
		color: var(--text-secondary);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-decoration: none;
	}
	a.wp-spond-name:hover {
		color: var(--text-primary);
		text-decoration: underline;
	}
	.wp-spond-rsvp {
		font-size: 0.72rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.wp-spond-rsvp--pending { color: #f59e0b; }
	.wp-spond-rsvp--declined { color: #6b7280; }
	.wp-spond-group {
		color: var(--text-tertiary);
		font-size: 0.72rem;
		flex-shrink: 0;
		max-width: 35%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wp-task-list,
	.wp-checklist {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-task,
	.wp-check-row {
		border: none;
		background: #0e1119;
		border-radius: 10px;
		padding: 10px;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.wp-check-row-parent {
		padding-bottom: 6px;
	}

	.wp-task-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}

	.wp-task-title {
		margin: 0;
		font-size: 0.95rem;
		color: #ddd;
	}

	.wp-task-title.done {
		color: #7c8498;
		text-decoration: line-through;
	}

	.wp-task-meta {
		margin: 4px 0 0;
		font-size: 0.72rem;
		color: #626b82;
	}

	.wp-task-intent-pill {
		margin: 6px 0 0;
		font-size: 0.72rem;
		padding: 4px 8px;
		border-radius: 6px;
		font-weight: 600;
		display: inline-block;
	}

	.wp-task-intent-pending {
		background: rgba(255, 193, 7, 0.1);
		color: #ffc107;
		border: 1px solid rgba(255, 193, 7, 0.3);
	}

	.wp-task-intent-parsed {
		background: rgba(76, 175, 80, 0.1);
		color: #4caf50;
		border: 1px solid rgba(76, 175, 80, 0.3);
	}

	.wp-task-intent-failed {
		background: rgba(244, 67, 54, 0.1);
		color: #f44336;
		border: 1px solid rgba(244, 67, 54, 0.3);
	}

	.wp-task-intent-failure-reason {
		margin: 4px 0 0;
		font-size: 0.82rem;
		color: #d94f4f;
		padding: 4px 0;
		line-height: 1.3;
	}

	.wp-task-evaluation {
		margin: 6px 0 0;
		font-size: 0.82rem;
		color: #7ec97e;
		padding: 0;
		line-height: 1.3;
		font-weight: 500;
	}

	.wp-slot-row {
		display: inline-flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wp-slot {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #353c50;
		font-size: 0.72rem;
		line-height: 1;
		color: #7180b8;
		background: #111624;
	}

	.wp-slot.checked {
		border-color: #5566b7;
		background: #1a2454;
		color: #ccd8ff;
	}

	.wp-slot-btn {
		cursor: pointer;
		padding: 0;
	}

	.wp-slot-btn:hover:not(.checked) {
		border-color: #4a5af0;
		background: #1a1f35;
	}

	.wp-check-group-label {
		flex: 1;
		font-size: 0.95rem;
	}

	.wp-task-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.wp-task-title-btn {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		color: inherit;
		text-align: left;
		cursor: text;
		flex: 1;
		display: block;
	}

	.wp-task-title-btn.done {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.wp-task-edit-input {
		width: 100%;
		padding: 4px 8px;
		font-size: 0.95rem;
		border-radius: 6px;
		border: 1px solid #4a5af0;
		background: #1a1f35;
		color: inherit;
		outline: none;
	}

	.wp-progress-track {
		height: 8px;
		border-radius: 999px;
		background: #151925;
		overflow: hidden;
	}

	.wp-plan-conv-link {
		display: inline-block;
		margin-top: 12px;
		font-size: 0.8rem;
		color: #7c8ef5;
		text-decoration: none;
	}
	.wp-plan-conv-link:hover {
		text-decoration: underline;
	}

	.wp-completion-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: #1a2040;
		font-size: 0.85rem;
		color: #c8d0f0;
	}

	.wp-completion-banner-actions {
		display: flex;
		gap: 8px;
	}

	.wp-completion-banner-btn {
		background: none;
		border: none;
		color: #7c8ef5;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 2px 6px;
	}
	.wp-completion-banner-btn:hover {
		text-decoration: underline;
	}


	.wp-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4a5af0, #6f7bf4);
	}

	.wp-check-row-main {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 10px;
		align-items: center;
	}

	.wp-check-row-right {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.wp-check-toggle,
	.wp-item-text-btn {
		border: none;
		background: transparent;
		padding: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.wp-item-text-btn {
		width: 100%;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.wp-food-affordance {
		border: none;
		background: transparent;
		padding: 0 4px;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 120ms ease;
	}

	.wp-food-affordance:hover {
		opacity: 1;
	}

	.wp-check-circle {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #3a4155;
		color: #4a5af0;
		font-size: 0.72rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.wp-check-circle.checked {
		border-color: #5fa080;
		background: rgba(95, 160, 128, 0.15);
		color: #5fa080;
	}

	.wp-check-circle.skipped {
		border-color: #774444;
		background: rgba(160, 80, 80, 0.18);
		color: #e07070;
	}

	.wp-check-text {
		font-size: 0.95rem;
		color: #ccc;
	}

	.wp-check-text.checked {
		color: #737d95;
		text-decoration: line-through;
	}

	.wp-check-text.skipped {
		color: #8a6868;
		text-decoration: line-through;
		text-decoration-color: #774444;
	}

	.wp-parent-progress {
		display: inline-flex;
		align-items: center;
		font-size: 0.68rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #8d96af;
		background: rgba(100, 112, 146, 0.16);
		border: 1px solid rgba(100, 112, 146, 0.35);
		border-radius: 999px;
		padding: 2px 7px;
		margin-right: 8px;
		vertical-align: middle;
	}

	.wp-parent-caret {
		width: 20px;
		height: 20px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: #7c8ef5;
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		transition: transform 0.18s ease, color 0.12s ease;
	}

	.wp-parent-caret:hover {
		color: #a9b5ff;
	}

	.wp-parent-caret.expanded {
		transform: rotate(90deg);
	}

	.wp-week-parent-circle {
		flex-shrink: 0;
		display: block;
	}

	.wp-day-children {
		margin-top: 8px;
		margin-left: 8px;
		padding-left: 12px;
		border-left: 1px solid #242a3a;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-day-child-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 10px;
		align-items: center;
		background: #0b0f18;
		border-radius: 8px;
		padding: 8px;
	}

	.wp-time-badge {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #7c8ef5;
		background: rgba(124, 142, 245, 0.1);
		border: 1px solid rgba(124, 142, 245, 0.25);
		border-radius: 5px;
		padding: 1px 5px;
		margin-right: 6px;
		vertical-align: middle;
		white-space: nowrap;
	}

	.wp-intent-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.68rem;
		color: rgba(100, 200, 170, 0.85);
		background: rgba(52, 211, 153, 0.08);
		border: 1px solid rgba(52, 211, 153, 0.18);
		border-radius: 6px;
		padding: 1px 6px;
		margin-left: 6px;
		vertical-align: middle;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wp-intent-badge--unlinked {
		color: rgba(160, 160, 180, 0.7);
		background: rgba(100, 100, 130, 0.08);
		border-color: rgba(100, 100, 130, 0.18);
	}

	.wp-edit-shell {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.wp-day-plan-headline {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border-radius: 10px;
		border: none;
		background: #0e121c;
	}

	.wp-day-plan-headline-row {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: flex-start;
	}

	.wp-ribbon {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}

	.wp-edit-input {
		height: 34px;
	}

	.wp-drag-handle {
		color: #5e6780;
		font-size: 0.92rem;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	.wp-check-row.is-dragging {
		opacity: 0.35;
	}

	.wp-check-row.is-drag-over {
		box-shadow: 0 -2px 0 0 #7c8ef5;
		background: rgba(124, 142, 245, 0.08);
	}

	.wp-add-form,
	.wp-notes-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.wp-field-shell {
		position: relative;
	}

	.wp-input,
	.wp-textarea {
		width: 100%;
		background: #0f121b;
		border: none;
		color: #ddd;
		border-radius: 10px;
		font: inherit;
	}

	.wp-input {
		height: 38px;
		padding: 0 10px;
	}

	.wp-textarea {
		padding: 10px;
		resize: vertical;
		min-height: 96px;
	}

	.wp-textarea-note {
		min-height: 66px;
	}

	.wp-save-dot {
		position: absolute;
		right: 12px;
		top: 12px;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(102, 112, 138, 0.38);
		box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		transition: background-color 160ms ease, box-shadow 220ms ease, opacity 220ms ease;
		opacity: 0;
	}

	.wp-save-dot.is-saving,
	.wp-save-dot.is-saved {
		opacity: 1;
	}

	.wp-save-dot.is-saving {
		background: #7c8ef5;
		animation: wp-dot-pulse 1s ease-in-out infinite;
	}

	.wp-save-dot.is-saved {
		background: #6ab08e;
		box-shadow: 0 0 0 5px rgba(106, 176, 142, 0.08);
	}

	@keyframes wp-dot-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(124, 142, 245, 0.22);
		}
		70% {
			box-shadow: 0 0 0 6px rgba(124, 142, 245, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		}
	}

	.wp-reminder-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.wp-reminder-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
		border-radius: 9px;
		background: #0f131c;
		border: none;
	}

	.wp-reminder-link {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		text-decoration: none;
		color: inherit;
		border-radius: 9px;
		outline: none;
	}

	.wp-reminder-link:focus-visible {
		box-shadow: inset 0 0 0 1px rgba(124, 142, 245, 0.65);
	}

	.wp-reminder-row.has-sensor-progress {
		gap: 10px;
	}

	.wp-reminder-main {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
	}

	.wp-reminder-title {
		font-size: 0.95rem;
		color: #d3d8e6;
		flex: 1;
	}

	.wp-reminder-date {
		font-size: 0.82rem;
		color: #7c86a2;
		white-space: nowrap;
	}

	.wp-sensor-progress {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-sensor-progress :global(.viz-progress-track),
	.wp-sensor-progress :global(.viz-marker-track) {
		margin-bottom: 0;
	}

	.wp-progress-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
	}

	.wp-progress-km {
		color: #9ca3af;
	}

	.wp-vision-text {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: #c5ccdf;
		padding: 10px;
		border-radius: 10px;
		border: none;
		background: #0f131d;
	}

	.wp-helper {
		margin: 2px 0 0;
		font-size: 0.82rem;
		color: #76809c;
	}

	.wp-empty {
		margin: 0;
		color: #7a8399;
		font-size: 0.82rem;
	}

	@media (max-width: 640px) {
		.week-plan-page {
			padding-left: 12px;
			padding-right: 12px;
		}

		.wp-day-label {
			font-size: 0.62rem;
		}

		.wp-day-number {
			font-size: 0.78rem;
		}
	}
</style>
