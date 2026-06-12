/**
 * Deterministiske mock-data for /design (og evt. fremtidig /design-review).
 * Regler: faste datoer, ingen Math.random() — /design er med i visuell regresjon.
 * Fixtures deles mellom demosidene; komponenter importeres der de brukes.
 */
import type { Checklist } from '$lib/components/composed/ChecklistWidget.svelte';
import type { WidgetData } from '$lib/client/widget-data-cache';
import type { DayData } from '$lib/components/visualizations/DayWheelChart.svelte';
import type { DomainStatus } from '$lib/components/visualizations/DomainWheelChart.svelte';
import type {
	GoalReminder,
	WeekDay,
	DayChecklist,
	DayRoutine,
	SpondEvent,
	WeekTask,
	WeekChecklist
} from '$lib/components/domain/ukeplan/types';
import type { WeekTasksApi } from '$lib/components/domain/ukeplan/week-tasks-api';
import type { Procedure } from '$lib/components/ui/ProcedureSheet.svelte';
import type {
	Greeting as KavalkadeGreeting,
	MonthEntry as KavalkadeMonthEntry,
	OrdskyWordView,
	ShowSlideDef,
	YearData as KavalkadeYearData
} from '$lib/components/domain/kavalkade';
import type { InterviewAnswers } from '$lib/flows/birthday-interview';
import type { ProcedureSheetApi } from '$lib/components/ui/procedure-sheet-api';
import type { WidgetConfig } from '$lib/components/ui/WidgetConfigSheet.svelte';
import type { ChecklistSheetApi } from '$lib/components/ui/checklist-sheet-api';
import type { FlowSheetApi } from '$lib/components/flows/flow-sheet-api';
import { buildEgenfrekvensSlotFlow } from '$lib/flows/egenfrekvens-slot';
import type { PeriodSlot } from '$lib/domains/egenfrekvens/period-slots';
import type { ChatMessage } from '$lib/client/chat-state.svelte';
import type { VisualizationDataContract } from '$lib/domain/visualization-spec';
import type { ShareApi } from '$lib/components/domain/share/share-api';
import type { LoadBreakdownSuggestions } from '$lib/components/ui/breakdown-api';
import type { AutoCheckPrompt } from '$lib/components/domain/ukeplan/autocheck';
import type { GeoCandidate } from '$lib/utils/geocode';
import type { WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
import type { FilterPreview, LoadFilterPreview } from '$lib/components/ui/widget-config-api';
import type { TrainingLoadPoint } from '$lib/util/training-load';

// ── ChecklistWidget ──────────────────────────────────────────────────────────
export function mkChecklist(id: string, title: string, emoji: string, itemTexts: string[], doneCount: number): Checklist {
	return {
		id,
		title,
		emoji,
		context: null,
		completedAt: doneCount >= itemTexts.length ? '2026-06-09T20:00:00Z' : null,
		items: itemTexts.map((text, i) => ({
			id: `${id}-${i}`,
			text,
			checked: i < doneCount,
			sortOrder: i
		}))
	};
}

const packItems = ['Regnjakke', 'Tursko', 'Ullundertøy', 'Hansker', 'Kart lastet ned', 'Hodelykt', 'Apotek-pakke', 'Powerbank'];
export const checklistEmpty = mkChecklist('cl-0', 'Bergenstur', '🏔', packItems, 0);
export const checklistHalf = mkChecklist('cl-1', 'Bergenstur', '🏔', packItems, 5);
export const checklistDone = mkChecklist('cl-2', 'Bergenstur', '🏔', packItems, 8);
export const checklistMonth = mkChecklist('cl-m', 'Juni', '📅', ['Rutine 1', 'Rutine 2', 'Rutine 3', 'Rutine 4'], 2);

// ── DynamicWidgetView ────────────────────────────────────────────────────────
export const widgetWeight: WidgetData = {
	current: 90.8,
	sparkline: [92.0, 91.8, 91.5, 91.2, 91.0, 90.9, 90.8],
	unit: 'kg',
	delta: -1.1,
	pct: 55,
	state: 'normal'
};

export const widgetSteps: WidgetData = {
	current: 8421,
	sparkline: [6200, 7100, 5400, 9800, 8000, 7600, 8421],
	unit: 'skritt',
	delta: 1200,
	pct: 84,
	state: 'success'
};

export const widgetSpend: WidgetData = {
	current: 17700,
	sparkline: [400, 1100, 380, 900, 620, 1080, 540],
	unit: 'kr dagligvare',
	delta: 2300,
	pct: 71,
	state: 'warn'
};

export const widgetSleep: WidgetData = {
	current: 7.8,
	sparkline: [],
	unit: 'timer søvn',
	delta: null,
	pct: null,
	state: 'normal'
};

// ── DayWheel / DomainWheel ───────────────────────────────────────────────────
const DEMO_PLANNED = [5, 3, 6, 4, 7, 2, 5, 4, 6, 3, 5, 7, 4, 6, 3, 5, 4, 6, 7, 5];
const DEMO_DONE    = [5, 2, 4, 4, 5, 2, 3, 4, 6, 1, 4, 5, 3, 4, 3, 5, 2, 5, 4, 3];

export const demoMonthDays: DayData[] = Array.from({ length: 30 }, (_, i) => {
	const day = i + 1;
	if (day < 21) return { planned: DEMO_PLANNED[i], completed: DEMO_DONE[i], isPast: true, isToday: false };
	if (day === 21) return { planned: 4, completed: 1, isPast: false, isToday: true };
	return { planned: 0, completed: 0, isPast: false, isToday: false };
});

export const demoDomains: DomainStatus[] = [
	{ id: 'health',    label: 'Helse',   color: '#5fa0a0', monthPct: 0.72, trend: 'up' },
	{ id: 'economics', label: 'Økonomi', color: '#f0b429', monthPct: 0.58, trend: 'flat' },
	{ id: 'food',      label: 'Mat',     color: '#d4829a', monthPct: 0.40, trend: 'down' }
];

// ── Treningsbelastning (BalanceCard / FormCard) ──────────────────────────────
export const loadSeries: TrainingLoadPoint[] = (() => {
	const pts: TrainingLoadPoint[] = [];
	const ctlAlpha = 1 - Math.exp(-1 / 42);
	const atlAlpha = 1 - Math.exp(-1 / 7);
	let ctl = 38;
	let atl = 38;
	for (let i = 0; i < 120; i++) {
		const hard = i % 7 === 2 || i % 7 === 5;
		const rest = i % 7 === 6;
		const effort = rest ? 0 : Math.max(0, Math.round(48 + 38 * Math.sin(i / 9) + (hard ? 45 : 0)));
		ctl += (effort - ctl) * ctlAlpha;
		atl += (effort - atl) * atlAlpha;
		const date = new Date(Date.UTC(2026, 1, 10 + i)).toISOString().slice(0, 10);
		pts.push({ date, effort, ctl, atl, tsb: ctl - atl });
	}
	return pts;
})();

// ── WeeklyEffortCard ─────────────────────────────────────────────────────────
export const effortByDay = [40, 120, 0, 160, 60, 200, 40];
export const effortTotal = effortByDay.reduce((a, b) => a + b, 0);
export const effortByFamily = { running: 290, strength: 160, walking: 100, cycling: 70 };
export const effortBaseline = { p4wAvg: 540, delta: 80 };

// ── ScreenTimeCard ───────────────────────────────────────────────────────────
const stHourAvg = [0, 0, 0, 0, 0, 5, 12, 18, 10, 8, 6, 9, 14, 11, 8, 10, 12, 15, 22, 30, 38, 32, 18, 6];
const stAvgPerDay = stHourAvg.reduce((a, b) => a + b, 0); // 284

export const screenWeekDays = [262, 301, 198, 340, 270, 332, 285].map((totalMinutes, i) => ({
	date: `2026-06-0${i + 1}`,
	totalMinutes,
	socialMinutes: [70, 95, 55, 120, 80, 130, 95][i],
	detailed: true
}));

export const screenThisWeek = {
	totalMinutes: 1988,
	avgPerDayMinutes: stAvgPerDay,
	maxDayMinutes: 340,
	socialMinutes: 645,
	socialAvgPerDayMinutes: 92,
	byCategory: { social: 645, entertainment: 520, productivity: 420, other: 403 },
	byHour: stHourAvg.map((v) => v * 7),
	socialByHour: stHourAvg.map((v, h) => Math.round(v * 7 * (h >= 18 ? 0.55 : 0.25))),
	dayCount: 7,
	hourlyDayCount: 7
};

export const screenPrevWeek = {
	...screenThisWeek,
	totalMinutes: 2240,
	avgPerDayMinutes: 320,
	maxDayMinutes: 380,
	socialMinutes: 740,
	socialAvgPerDayMinutes: 106,
	byHour: stHourAvg.map((v) => Math.round(v * 7 * 1.13)),
	socialByHour: stHourAvg.map((v, h) => Math.round(v * 7 * 1.13 * (h >= 18 ? 0.55 : 0.25)))
};

export const screenGoals = [
	{
		id: 'sg1',
		title: 'Maks 1 t sosiale medier per dag',
		currentMinutes: 92,
		targetMinutes: 60,
		withinTarget: false,
		pct: 153,
		deltaMinutes: 32,
		basisLabel: 'snitt per dag'
	}
];

export const screenCumulative = (() => {
	const out: number[] = [0];
	let acc = 0;
	for (let d = 0; d < 7; d++) {
		const scale = screenWeekDays[d].totalMinutes / stAvgPerDay;
		for (let h = 0; h < 24; h++) {
			acc += stHourAvg[h] * scale;
			out.push(Math.round(acc));
		}
	}
	return out;
})();

export const screenCumulativeRefs = [
	screenCumulative.map((v) => Math.round(v * 1.18)),
	screenCumulative.map((v) => Math.round(v * 0.84))
];

export const screenCategoryLabels = {
	social: 'Sosiale medier',
	entertainment: 'Underholdning',
	productivity: 'Produktivitet',
	other: 'Annet'
};

// ── ProjectCard ──────────────────────────────────────────────────────────────
export const projectActive = {
	id: 'p1',
	title: 'Platting i hagen',
	description: 'Riv gammel terrasse, ny platting med innfelt belysning.',
	emoji: '🪵',
	domain: 'hus',
	type: 'prosjekt',
	status: 'active',
	progress: {
		projectId: 'p1',
		tasksTotal: 9,
		tasksDone: 4,
		itemsTotal: 12,
		itemsDone: 7,
		spentNok: 18400,
		budgetNok: 35000,
		percentComplete: 52,
		budgetPercent: 53
	}
};

export const projectDone = {
	id: 'p2',
	title: 'Male barnerommet',
	emoji: '🎨',
	domain: 'hus',
	type: 'prosjekt',
	status: 'done',
	progress: {
		projectId: 'p2',
		tasksTotal: 5,
		tasksDone: 5,
		itemsTotal: 3,
		itemsDone: 3,
		spentNok: 3200,
		budgetNok: null,
		percentComplete: 100,
		budgetPercent: null
	}
};

// ── WeekGoals (ukeplan) ──────────────────────────────────────────────────────
export const weekGoalsVision = 'Ta hverdagene på alvor — trene jevnt, sove nok og være til stede.';

export const weekGoalsMock: GoalReminder[] = [
	{
		id: 'g1',
		title: 'Ned til 88 kg før sommeren',
		targetDate: '2026-06-30',
		metadata: {},
		sensorProgress: {
			kind: 'weight_change',
			startDate: '2026-01-01',
			endDate: '2026-06-30',
			startWeight: 94,
			currentWeight: 90.8,
			expectedWeight: 90.2,
			targetWeight: 88,
			status: 'yellow',
			points: [
				{ date: '2026-03-01', weight: 93.1 },
				{ date: '2026-04-01', weight: 92.2 },
				{ date: '2026-05-01', weight: 91.4 },
				{ date: '2026-06-01', weight: 90.8 }
			]
		}
	},
	{
		id: 'g2',
		title: '500 km løping i 2026',
		targetDate: '2026-12-31',
		metadata: {},
		sensorProgress: {
			kind: 'running_distance',
			currentKm: 212,
			expectedKm: 230,
			targetKm: 500,
			status: 'yellow'
		}
	},
	{ id: 'g3', title: 'Lese 12 bøker', targetDate: null, metadata: {}, sensorProgress: null }
];

// ── DaySection (ukeplan) ─────────────────────────────────────────────────────
// Fast uke (man 8.–søn 14. juni 2026); todayIso settes som prop → deterministisk.
const dsWeekIsoDates = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14'];
const dsWeekDayLabels = ['man.', 'tir.', 'ons.', 'tor.', 'fre.', 'lør.', 'søn.'];

export const daySectionWeekDays: WeekDay[] = dsWeekIsoDates.map((isoDate, i) => ({
	isoDate,
	label: dsWeekDayLabels[i],
	day: String(8 + i)
}));

export const daySectionTodayIso = '2026-06-10';

export const daySectionChecklists: Record<string, DayChecklist> = {
	'2026-06-10': {
		id: 'dc-1',
		title: 'Onsdag',
		completedAt: null,
		items: [
			{ id: 'd1', text: 'Levere i barnehagen', checked: true },
			{ id: 'd2', text: 'Svømmehall', checked: false, metadata: { timeHour: 6, timeMinute: 0 } },
			{ id: 'd3', text: 'Handle middag', checked: false },
			{ id: 'd5', text: 'Pakke til Bergen', checked: false },
			{ id: 'd5a', text: 'Finne sovepose', checked: true, parentId: 'd5' },
			{ id: 'd5b', text: 'Lade powerbank', checked: false, parentId: 'd5' },
			{ id: 'd4', text: 'Tidlig seng', checked: false }
		]
	}
};

export const daySectionRoutines: Record<string, DayRoutine[]> = {
	'2026-06-10': [
		{
			definitionId: 'rd-1',
			checklistId: 'rc-1',
			title: 'Morgenrutine',
			emoji: '🌅',
			slot: 'morning',
			completedAt: null,
			items: [
				{ id: 'r1', text: 'Matpakker', checked: true, sortOrder: 0, estimateMinutes: 10 },
				{ id: 'r2', text: 'Tømme oppvaskmaskin', checked: true, sortOrder: 1, estimateMinutes: 5 },
				{ id: 'r3', text: 'Veie meg', checked: false, sortOrder: 2, estimateMinutes: 1 }
			]
		}
	]
};

export const daySectionSpondEvents: Record<string, SpondEvent[]> = {
	'2026-06-10': [
		{
			id: 'sp-1',
			name: 'Fotballtrening G2018',
			startTimestamp: '2026-06-10T17:00:00+02:00',
			endTimestamp: '2026-06-10T18:30:00+02:00',
			cancelled: false,
			groupName: 'G2018',
			location: { name: 'Voldsløkka', address: null },
			rsvp: 'accepted',
			spondEventId: null
		}
	]
};

export const daySectionHeadlines: Record<string, string> = {
	'2026-06-10': 'Svøm før jobb?'
};

export const daySectionHomeWeather = {
	'2026-06-10': {
		emoji: '☀️',
		tempMax: 21,
		periods: [
			{ key: 'morgen', label: 'Morgen', emoji: '🌤️', temp: 14, precip: 0 },
			{ key: 'ettermiddag', label: 'Ettermiddag', emoji: '☀️', temp: 21, precip: 0 },
			{ key: 'kveld', label: 'Kveld', emoji: '⛅', temp: 17, precip: 0.2 }
		]
	}
};

const asyncNoop = async () => {};

/** Data + noop-callbacks for DaySection-demoen på /design. */
export const daySectionFixture = {
	weekDays: daySectionWeekDays,
	selectedDayIso: daySectionTodayIso,
	todayIso: daySectionTodayIso,
	dayChecklistsState: daySectionChecklists,
	dayRoutinesState: daySectionRoutines,
	dayHeadlinesState: daySectionHeadlines,
	spondEventsByDay: daySectionSpondEvents,
	tripDayEmoji: {} as Record<string, string>,
	tripDayWeather: {},
	homeDayWeather: daySectionHomeWeather,
	dayCloseMessage: '',
	saveStateDayItems: 'idle' as const,
	saveStateDayNote: 'idle' as const,
	editingItem: null,
	expandedDayParentIds: new Set(['d5']),
	expandedRoutineIds: new Set<string>(),
	onSetSelectedDay: () => {},
	onToggleChecklistItem: asyncNoop,
	onDeleteChecklistItem: asyncNoop,
	onReorderChecklistItems: asyncNoop,
	onSaveEditedItem: asyncNoop,
	onStartEditing: () => {},
	onContextMenuOpen: () => {},
	onToggleDayParent: () => {},
	onToggleRoutineExpansion: () => {},
	onRoutineItemToggle: asyncNoop,
	onAddChild: asyncNoop,
	onCreateDayItem: asyncNoop,
	onEnsureDayChecklist: async () => null,
	onSaveDayHeadline: asyncNoop,
	onUpdateDayHeadline: () => {}
};

// ── WeekTasks (ukeplan) ──────────────────────────────────────────────────────
/** Nettverkslag-mock: WeekTasks rendres uten et eneste fetch-kall. */
export const mockWeekTasksApi: WeekTasksApi = {
	matchProcedure: async () => null,
	getProcedure: async () => null,
	applyProcedure: async () => {},
	startTaskChat: async () => {},
	deleteTask: async () => {},
	updateTaskTitle: async () => {}
};

const weekTasksMock: WeekTask[] = [
	{
		id: 'wt-1',
		title: 'Svømme to ganger',
		frequency: 'weekly',
		targetValue: 2,
		unit: 'ganger',
		metadata: {
			intentStatus: 'parsed',
			intentEvaluation: { currentValue: 1, targetValue: 2, met: false },
			matchedProcedureId: 'proc-1',
			matchedProcedureTitle: 'Svømmetur-pakking',
			matchedProcedureEmoji: '🏊'
		},
		repeatCount: 2,
		completedCount: 1,
		goalTitle: 'Bedre kondis',
		themeName: 'Helse'
	},
	{
		id: 'wt-2',
		title: 'Veie meg hver morgen',
		frequency: 'daily',
		targetValue: null,
		unit: null,
		metadata: {},
		repeatCount: 7,
		completedCount: 4,
		goalTitle: 'Ned til 88 kg',
		themeName: 'Helse'
	},
	{
		id: 'wt-3',
		title: 'Løpe mye',
		frequency: 'weekly',
		targetValue: null,
		unit: null,
		metadata: { intentStatus: 'failed', intentError: 'no_quantifiable_target' },
		repeatCount: 1,
		completedCount: 0,
		goalTitle: null,
		themeName: null
	}
];

const weekChecklistMock: WeekChecklist = {
	id: 'wc-1',
	title: 'Uke 24',
	emoji: '📋',
	completedAt: null,
	items: [
		{ id: 'w1', text: 'Bestille time hos frisøren', checked: true },
		{ id: 'w2', text: 'Planlegge bursdagen til Eira', checked: false },
		{ id: 'w3', text: 'Svare borettslaget om dugnad', checked: true },
		{ id: 'w4', text: 'Bytte til sommerdekk', checked: false }
	]
};

// ── ChecklistSheet ───────────────────────────────────────────────────────────
/**
 * IO-mock: avkryssing/redigering «lykkes» lokalt (optimistisk UI beholdes),
 * nye punkter fabrikkeres med deterministiske id-er, vær/geo er avskrudd.
 */
let mockItemCounter = 0;
export const mockChecklistSheetApi: ChecklistSheetApi = {
	patchItem: async () => true,
	deleteItem: async () => true,
	addItems: async (_checklistId, text, sortOrder, parentId) => [
		{ id: `mock-add-${mockItemCounter++}`, text, checked: false, sortOrder, parentId: parentId ?? null }
	],
	createChecklist: async () => ({ id: 'mock-backing' }),
	createItems: async (_checklistId, { text, sortOrder }) => [
		{ id: `mock-new-${mockItemCounter++}`, text, checked: false, sortOrder }
	],
	snoozeItem: async () => true,
	saveBreakdown: async () => null,
	deleteChecklist: async () => {},
	resolvePlace: async () => ({ status: 'none' }),
	geocodePlace: async () => null,
	getDeviceCoords: async () => ({ lat: 59.9139, lon: 10.7522 }),
	readWeatherCache: () => null,
	fetchWeatherTimeseries: async () => null
};

export const checklistSheetFixture = {
	id: 'cls-1',
	title: 'Onsdag',
	emoji: '☑️',
	context: null,
	completedAt: null,
	items: [
		{ id: 'csi-1', text: 'Svømmehall', checked: true, sortOrder: 0, metadata: { timeHour: 6, timeMinute: 0 } },
		{ id: 'csi-2', text: 'Levere i barnehagen', checked: true, sortOrder: 1, metadata: { timeHour: 8, timeMinute: 15 } },
		{ id: 'csi-3', text: 'Handle middag', checked: false, sortOrder: 2 },
		{ id: 'csi-4', text: 'Pakke til Bergen', checked: false, sortOrder: 3 },
		{ id: 'csi-4a', text: 'Finne sovepose', checked: true, sortOrder: 4, parentId: 'csi-4' },
		{ id: 'csi-4b', text: 'Lade powerbank', checked: false, sortOrder: 5, parentId: 'csi-4' },
		{ id: 'csi-5', text: 'Støvsuge bilen', checked: false, sortOrder: 6, skippedAt: '2026-06-10T08:00:00Z' }
	]
};

export const checklistSheetRoutines = [
	{
		checklistId: 'rc-2',
		title: 'Morgenrutine',
		emoji: '🌅',
		slot: 'morning',
		items: [
			{ id: 'cr-1', text: 'Matpakker', checked: true, sortOrder: 0, estimateMinutes: 10 },
			{ id: 'cr-2', text: 'Tømme oppvaskmaskin', checked: true, sortOrder: 1, estimateMinutes: 5 },
			{ id: 'cr-3', text: 'Veie meg', checked: false, sortOrder: 2, estimateMinutes: 1 }
		]
	}
];

export const checklistSheetDoneFixture = {
	id: 'cls-2',
	title: 'Bergenstur',
	emoji: '🏔',
	context: null,
	completedAt: null,
	items: [
		{ id: 'csd-1', text: 'Regnjakke', checked: true, sortOrder: 0 },
		{ id: 'csd-2', text: 'Tursko', checked: true, sortOrder: 1 },
		{ id: 'csd-3', text: 'Hodelykt', checked: true, sortOrder: 2 },
		{ id: 'csd-4', text: 'Powerbank', checked: true, sortOrder: 3 }
	]
};

// ── FlowSheet ────────────────────────────────────────────────────────────────
export const mockFlowSheetApi: FlowSheetApi = {
	fetchDayWeather: async () => null,
	fetchDaySuggestions: async () => ['Rydde kjøkkenet', 'Ringe mormor', '20 min lesing']
};

// ── Bøker ────────────────────────────────────────────────────────────────────
import type { Book, BookTabsApi, BookClip, ProgressLogEntry } from '$lib/components/domain/book-api';

export const bookMock: Book = {
	id: 'b-1',
	title: 'Sult',
	author: 'Knut Hamsun',
	coverUrl: null,
	totalPages: 232,
	currentPage: 148,
	format: 'both',
	totalMinutes: 412,
	currentMinutes: 263,
	status: 'reading',
	conversationId: null,
	contextStatus: 'ready',
	contextPack: null,
	contextProgress: null,
	startedAt: '2026-05-20T00:00:00Z',
	finishedAt: null,
	loanDueDate: '2026-06-28',
	loanStartDate: '2026-06-01',
	createdAt: '2026-05-20T00:00:00Z'
};

const bookProgressLogMock: ProgressLogEntry[] = [
	{ id: 'pl-1', currentPage: 42, currentMinutes: 70, loggedAt: '2026-05-24T20:00:00Z' },
	{ id: 'pl-2', currentPage: 80, currentMinutes: 140, loggedAt: '2026-05-28T20:00:00Z' },
	{ id: 'pl-3', currentPage: 112, currentMinutes: 198, loggedAt: '2026-06-03T20:00:00Z' },
	{ id: 'pl-4', currentPage: 148, currentMinutes: 263, loggedAt: '2026-06-09T20:00:00Z' }
];

export const bookClipsMock: BookClip[] = [
	{
		id: 'clip-1',
		bookId: 'b-1',
		text: 'Det var i den Tid, jeg gik omkring og sulted i Kristiania, denne forunderlige By, som ingen forlader, før han har faaet Mærker af den.',
		page: 1,
		position: null,
		note: 'Åpningslinjen',
		source: null,
		audioUrl: '',
		words: [
			{ word: 'Det', start: 0, end: 0.25 },
			{ word: 'var', start: 0.25, end: 0.45 },
			{ word: 'i', start: 0.45, end: 0.55 },
			{ word: 'den', start: 0.55, end: 0.75 },
			{ word: 'Tid,', start: 0.75, end: 1.1 },
			{ word: 'jeg', start: 1.1, end: 1.3 },
			{ word: 'gik', start: 1.3, end: 1.55 },
			{ word: 'omkring', start: 1.55, end: 2.0 },
			{ word: 'og', start: 2.0, end: 2.1 },
			{ word: 'sulted', start: 2.1, end: 2.5 },
			{ word: 'i', start: 2.5, end: 2.6 },
			{ word: 'Kristiania', start: 2.6, end: 3.4 }
		],
		characters: ['Fortelleren'],
		createdAt: '2026-06-01T10:00:00Z'
	},
	{
		id: 'clip-2',
		bookId: 'b-1',
		text: 'Jeg var saa lykkelig som faa Mennesker kan være det.',
		page: 87,
		position: null,
		note: null,
		source: null,
		audioUrl: null,
		words: null,
		characters: null,
		createdAt: '2026-06-05T18:00:00Z'
	}
];

export const mockBookTabsApi: BookTabsApi = {
	getProgressLog: async () => bookProgressLogMock,
	updateBook: async (_themeId, _bookId, patch) => ({ ...bookMock, ...patch }),
	deleteBook: async () => {},
	getClips: async () => bookClipsMock,
	createClip: async (_themeId, _bookId, input) => ({
		id: 'clip-new',
		bookId: 'b-1',
		text: input.text,
		page: input.page,
		position: input.position,
		note: input.note,
		source: null,
		audioUrl: null,
		words: null,
		characters: input.characters,
		createdAt: '2026-06-12T00:00:00Z'
	}),
	deleteClip: async () => {},
	refreshContext: async () => new Response(JSON.stringify({ action: 'requeued' })),
	uploadImage: async () => new Response(JSON.stringify({})),
	transcribe: async () => new Response(JSON.stringify({})),
	streamChatMessages: async () => new Response('')
};

export const bookWithPackMock: Book = {
	...bookMock,
	contextPack: {
		metadata: { year: 1890, genre: 'Roman' },
		authorContext: {
			bio: 'Knut Hamsun (1859–1952) regnes som en av modernismens pionerer i nordisk litteratur.',
			themes: ['sult', 'psykologi', 'byliv'],
			howBookFits: 'Gjennombruddsromanen — det første store verket i forfatterskapet.'
		},
		themes: ['Eksistens', 'Stolthet', 'Kropp og sinn'],
		criticReviews: [
			{
				source: 'Morgenbladet',
				url: 'https://example.org/anmeldelse',
				verdict: 'positive',
				quote: 'Et nervøst mesterverk som åpner en ny epoke i romankunsten.'
			}
		],
		reception: {
			critics: 'Banebrytende psykologisk realisme.',
			readers: 'Leses fortsatt som rystende aktuell.'
		},
		conversationHints: ['Hva gjør sulten med fortellerens selvbilde?', 'Byen som motstander']
	}
};

export const bookChatMessagesMock = [
	{ role: 'user' as const, text: 'Hva er det med åpningslinjen som gjør den så berømt?' },
	{
		role: 'assistant' as const,
		text: 'Den etablerer alt på én gang: sulten, byen som aktør («ingen forlader, før han har faaet Mærker af den») og den tilbakeskuende fortelleren. Merk at *Kristiania* nevnes før jeg-et — byen er hovedmotstanderen.'
	},
	{ role: 'user' as const, text: 'Les klippet fra side 87 i lys av det' }
];

// ── Hjemskjerm-elementer ─────────────────────────────────────────────────────
export const themeButtonsMock = [
	{ id: 'helse', name: 'Helse', emoji: '💪' },
	{ id: 'okonomi', name: 'Økonomi', emoji: '💰' },
	{ id: 'familie', name: 'Familie', emoji: '👨‍👩‍👧' },
	{ id: 'egenfrekvens', name: 'Egenfrekvens', emoji: '🌊' },
	{ id: 'boker', name: 'Bøker', emoji: '📚' },
	{ id: 'hjem', name: 'Hjem', emoji: '🏡' }
];

export const actionPillsMock = [
	{ id: 'ap-1', icon: '⚖️', label: 'Vekt', value: '90.8', done: true },
	{ id: 'ap-2', icon: '🏃', label: 'Løp', value: '2/5', done: false },
	{ id: 'ap-3', icon: '😴', label: 'Søvn', done: false },
	{ id: 'ap-4', icon: '✨', label: 'Sjekk inn', done: false }
];

export const readinessMock = {
	programName: 'Halvmaraton-program',
	state: 'klar' as const,
	alternativeName: null
};

export const conversationThemesMock = [
	{ id: 'helse', name: 'Helse', emoji: '💪' },
	{ id: 'okonomi', name: 'Økonomi', emoji: '💰' },
	{ id: 'familie', name: 'Familie', emoji: null }
];

export const mockConversationMenuApi = {
	patchConversation: async () => {},
	deleteConversation: async () => {}
};

// ── Slot-sjekkin (fokus-FlowSheet) ───────────────────────────────────────────
const slotMock: PeriodSlot = {
	id: 'arbeidsdag',
	label: 'arbeidsdagen',
	shortLabel: 'Arbeidsdag',
	emoji: '💼',
	question: 'Hvordan gikk arbeidsdagen?',
	fromMinutes: 480,
	toMinutes: 1020
};

export const slotCheckinFlow = {
	...buildEgenfrekvensSlotFlow(slotMock),
	onComplete: async () => {}
};

// ── ChatMessages ─────────────────────────────────────────────────────────────
export const chatMessagesMock: ChatMessage[] = [
	{ id: 'cm-1', role: 'user', text: 'Jeg veide 90.8 i dag', starred: false },
	{
		id: 'cm-2',
		role: 'assistant',
		text: 'Registrert! Du er **ned 1,1 kg** siste 30 dager — litt bak kurven mot 88 kg, men riktig retning.',
		starred: false
	},
	{ id: 'cm-3', role: 'user', text: 'Hva bør jeg fokusere på denne uka?', starred: false },
	{
		id: 'cm-4',
		role: 'assistant',
		text: 'To ting gir mest effekt nå:\n\n1. **Svøm tirsdag morgen** — du har 1 av 2 økter igjen\n2. **Tidlig seng onsdag** — søvnsnittet ditt er 6t 40m denne uka',
		starred: true,
		actions: [
			{ id: 'a-plan', label: 'Legg i ukeplanen' },
			{ id: 'a-skip', label: 'Ikke nå' }
		] as ChatMessage['actions']
	}
];

// ── MetricCard / visualiseringer ─────────────────────────────────────────────
export const metricRunning: VisualizationDataContract = {
	current: 212,
	target: 500,
	expectedByNow: 230,
	startValue: 0,
	startDate: '2026-01-01',
	endDate: '2026-12-31',
	series: [
		{ date: '2026-02-01', value: 38 },
		{ date: '2026-03-01', value: 85 },
		{ date: '2026-04-01', value: 132 },
		{ date: '2026-05-01', value: 176 },
		{ date: '2026-06-01', value: 212 }
	]
};

export const metricWeight: VisualizationDataContract = {
	current: 90.8,
	target: 88,
	expectedByNow: 90.2,
	startValue: 94,
	startDate: '2026-01-01',
	endDate: '2026-06-30',
	series: [
		{ date: '2026-02-01', value: 93.1 },
		{ date: '2026-03-01', value: 92.2 },
		{ date: '2026-04-01', value: 91.4 },
		{ date: '2026-05-01', value: 91.0 },
		{ date: '2026-06-01', value: 90.8 }
	]
};

export const metricSleep: VisualizationDataContract = {
	current: 7.4,
	target: 7.5,
	targetMin: 7,
	targetMax: 8.5,
	expectedByNow: 7.5
};

export const metricSteps: VisualizationDataContract = {
	current: 8421,
	target: 8000,
	expectedByNow: 8000,
	comparisonSeries: [
		{ label: 'Man', current: 6200, reference: 7400 },
		{ label: 'Tir', current: 7100, reference: 7600 },
		{ label: 'Ons', current: 5400, reference: 7100 },
		{ label: 'Tor', current: 9800, reference: 8000 },
		{ label: 'Fre', current: 8000, reference: 7900 }
	]
};

export const metricGrocery: VisualizationDataContract = {
	current: 17700,
	target: 20000,
	expectedByNow: 14800
};

// ── Overlays (menyer & modaler) ──────────────────────────────────────────────
export const taskMenuAnchor = {
	top: 56,
	left: 24,
	right: 280,
	bottom: 92,
	width: 256,
	height: 36,
	x: 24,
	y: 56,
	toJSON: () => ({})
} as DOMRect;

export const autoCheckPromptMock: AutoCheckPrompt = {
	kind: 'day',
	checklistId: 'dc-1',
	itemId: 'd-x',
	itemText: 'Løpetur',
	activityType: 'running',
	durationMinutes: 42,
	startTimeIso: '2026-06-10T06:45:00+02:00'
};

export const geoCandidatesMock: GeoCandidate[] = [
	{ lat: 59.66, lon: 10.61, label: 'Håøya, Frogn, Akershus', importance: 0.62, distanceKm: 32 },
	{ lat: 63.83, lon: 9.71, label: 'Håøya, Ørland, Trøndelag', importance: 0.48, distanceKm: 480 },
	{ lat: 59.09, lon: 10.41, label: 'Håøya, Færder, Vestfold', importance: 0.41, distanceKm: 88 }
];

export const weatherPeriodsMock: WeatherPeriod[] = [
	{ key: 'natt', label: 'Natt', emoji: '🌙', temp: 9, precip: 0, isPast: true },
	{ key: 'morgen', label: 'Morgen', emoji: '🌤️', temp: 14, precip: 0 },
	{ key: 'ettermiddag', label: 'Ettermiddag', emoji: '☀️', temp: 21, precip: 0 },
	{ key: 'kveld', label: 'Kveld', emoji: '🌧️', temp: 16, precip: 2.4 }
];

export const mockShareApi: ShareApi = {
	loadShares: async () => [
		{
			id: 'sh-1',
			token: 'demo-token',
			accessMode: 'write',
			allowedEmail: null,
			label: 'Familie',
			expiresAt: '2026-07-01T00:00:00Z',
			lastAccessedAt: '2026-06-09T18:30:00Z',
			accessCount: 14,
			createdAt: '2026-06-01T10:00:00Z'
		}
	],
	createShare: async () => ({ ok: true, token: 'demo-token-2' }),
	revokeShare: async () => true
};

export const mockLoadBreakdownSuggestions: LoadBreakdownSuggestions = async () => [
	'Finne frem malingsutstyr',
	'Vaske og sparkle veggene',
	'Male første strøk',
	'Male andre strøk',
	'Rydde og vaske utstyret'
];

// ── ProcedureSheet ───────────────────────────────────────────────────────────
export const mockProcedureSheetApi: ProcedureSheetApi = {
	updateProcedure: async () => {}
};

export const procedureMock: Procedure = {
	id: 'proc-1',
	title: 'Svømmetur-pakking',
	emoji: '🏊',
	summary:
		'## Kvelden før\n\nLegg frem **badetøy og håndkle** så du slipper å lete om morgenen. Sjekk åpningstidene — *morgensvøm åpner 06.00*.\n\n## Selve turen\n\n- Spis lett før du drar\n- Husk hengelås til garderobeskapet\n- 30–40 min i vannet er nok',
	domain: 'helse',
	shared: true,
	version: 3,
	steps: [
		{ id: 'st-1', text: 'Pakke badetøy og håndkle', sortOrder: 0, isOptional: false },
		{ id: 'st-2', text: 'Finne frem hengelås', sortOrder: 1, isOptional: false },
		{ id: 'st-3', text: 'Fylle vannflaske', sortOrder: 2, isOptional: false },
		{ id: 'st-4', text: 'Legge svømmebriller i sekken', sortOrder: 3, isOptional: true },
		{ id: 'st-5', text: 'Sette alarm til 05.30', sortOrder: 4, isOptional: false }
	],
	metadata: { appliedCount: 7, sourceConversationTitle: 'Morgensvømming' },
	conversationId: null,
	createdAt: '2026-03-12T09:00:00Z',
	updatedAt: '2026-05-30T18:00:00Z'
};

// ── WidgetConfigSheet ────────────────────────────────────────────────────────
export const widgetConfigMock: WidgetConfig = {
	id: 'w-1',
	title: 'Dagligvarer',
	metricType: 'amount',
	aggregation: 'sum',
	period: 'day',
	range: 'last30',
	unit: 'kr',
	color: '#f0b429',
	pinned: true,
	goal: 15000,
	thresholdWarn: 18000,
	thresholdSuccess: 14000,
	filterCategory: 'dagligvarer',
	filterSubcategory: null
};

const filterPreviewMock: FilterPreview = {
	totalSpendTxCountInRange: 183,
	categorizedMatchCount: 42,
	keywordMatchCount: 5,
	sampleMatches: [
		{ date: '2026-06-08', description: 'KIWI STORO', amount: -289 },
		{ date: '2026-06-07', description: 'REMA 1000 BJØLSEN', amount: -412 },
		{ date: '2026-06-05', description: 'ODA AS', amount: -1084 }
	],
	sensorEventsTxCount: 183
};

export const mockLoadFilterPreview: LoadFilterPreview = async () => filterPreviewMock;

/** Data + noop-callbacks + mock-API for WeekTasks-demoen på /design. */
export const weekTasksFixture = {
	weekTasks: weekTasksMock,
	weekChecklistState: weekChecklistMock,
	dashedKey: '2026-W24',
	weekPlanJustCompleted: false,
	planConversationId: null,
	saveStateWeekItems: 'idle' as const,
	onCreateChecklistItem: asyncNoop,
	onToggleChecklistItem: asyncNoop,
	onDeleteChecklistItem: asyncNoop,
	onReorderChecklistItems: asyncNoop,
	onSaveEditedItem: asyncNoop,
	onStartEditing: () => {},
	onCreateWeekChecklist: () => {},
	onSetWeekPlanJustCompleted: () => {},
	onContextMenuOpen: () => {},
	onToggleWeekParent: () => {},
	onAddChild: asyncNoop,
	expandedWeekParentIds: new Set<string>(),
	editingItem: null,
	selectedDayIso: daySectionTodayIso,
	dayChecklistId: null,
	api: mockWeekTasksApi
};

// ── Kavalkade-fixtures (bursdagsrigget på /kavalkade) ────────────────────────


export const kavalkadeCurrentYearMock: KavalkadeYearData = {
	workoutCount: 142,
	sports: [
		{ family: 'running', label: 'løpt', count: 68, distanceKm: 512.4, durationHours: 47.2 },
		{ family: 'walking', label: 'gått', count: 41, distanceKm: 188.9, durationHours: 39.5 },
		{ family: 'strength', label: 'styrketrent', count: 33, distanceKm: 0, durationHours: 24.8 }
	],
	stepsTotal: 2_841_000,
	sleepAvgHours: 7.1,
	weightStartKg: 84.6,
	weightEndKg: 82.1,
	weightChangeKg: -2.5,
	screenTimeAvgMinPerDay: 162,
	books: [
		{ title: 'Solaris', author: 'Stanisław Lem' },
		{ title: 'Stoner', author: 'John Williams' },
		{ title: 'Min kamp 3', author: 'Karl Ove Knausgård' }
	]
};

export const kavalkadePreviousYearMock: KavalkadeYearData = {
	workoutCount: 117,
	sports: [
		{ family: 'running', label: 'løpt', count: 51, distanceKm: 387.2, durationHours: 36.9 },
		{ family: 'walking', label: 'gått', count: 48, distanceKm: 201.3, durationHours: 42.1 },
		{ family: 'strength', label: 'styrketrent', count: 18, distanceKm: 0, durationHours: 13.5 }
	],
	stepsTotal: 2_512_000,
	sleepAvgHours: 6.8,
	weightStartKg: 86.2,
	weightEndKg: 84.6,
	weightChangeKg: -1.6,
	screenTimeAvgMinPerDay: 191,
	books: [{ title: 'Sult', author: 'Knut Hamsun' }]
};

export const kavalkadeOrdskyMock: OrdskyWordView[] = [
	{ word: 'rydde', count: 34, weight: 1 },
	{ word: 'kjøpe', count: 28, weight: 0.81 },
	{ word: 'ringe', count: 22, weight: 0.63 },
	{ word: 'løpetur', count: 19, weight: 0.53 },
	{ word: 'hente', count: 17, weight: 0.47 },
	{ word: 'garasjen', count: 14, weight: 0.38 },
	{ word: 'bursdag', count: 12, weight: 0.31 },
	{ word: 'svømmehall', count: 10, weight: 0.25 },
	{ word: 'bibliotek', count: 9, weight: 0.22 },
	{ word: 'planlegge', count: 8, weight: 0.19 },
	{ word: 'middagsplan', count: 7, weight: 0.16 },
	{ word: 'dekkskift', count: 5, weight: 0.09 },
	{ word: 'vanne', count: 4, weight: 0.06 },
	{ word: 'tannlege', count: 3, weight: 0.03 },
	{ word: 'epost', count: 2, weight: 0 }
];

export const kavalkadeTimelineMock: KavalkadeMonthEntry[] = [
	{
		key: '2025-07',
		label: 'juli 2025',
		workoutCount: 16,
		topSport: { family: 'running', label: 'løpt', distanceKm: 64.2, count: 9 },
		stepsTotal: 312_000,
		books: ['Solaris'],
		headline: 'Ferie og lange turer'
	},
	{
		key: '2025-08',
		label: 'august 2025',
		workoutCount: 12,
		topSport: { family: 'running', label: 'løpt', distanceKm: 48.1, count: 7 },
		stepsTotal: 264_000,
		books: [],
		headline: null
	},
	{
		key: '2025-09',
		label: 'september 2025',
		workoutCount: 0,
		topSport: null,
		stepsTotal: null,
		books: [],
		headline: null
	},
	{
		key: '2025-10',
		label: 'oktober 2025',
		workoutCount: 14,
		topSport: { family: 'strength', label: 'styrketrent', distanceKm: 0, count: 8 },
		stepsTotal: 198_000,
		books: ['Stoner'],
		headline: 'Innemåned — styrke og lesing'
	}
];

export const kavalkadeGreetingsMock: KavalkadeGreeting[] = [
	{
		character: 'Kris Kelvin',
		book: 'Solaris',
		text: 'Gratulerer med dagen. Jeg har lært at det vi husker, former oss mer enn det vi opplever — måtte minnene dine fra i år være av det snille slaget.'
	},
	{
		character: 'William Stoner',
		book: 'Stoner',
		text: 'Et stille år er også et liv. Du har lest, du har gått, du har holdt ut. Det er mer enn de fleste. Gratulerer.'
	}
];

export const kavalkadeInterviewAnswersMock: InterviewAnswers = {
	who: 'En som løper lenger og scroller mindre. Mer ute, mer til stede.',
	role_dad: 'Mer til stede på hverdagene — leksetid uten telefon.',
	health_talk: 'Var: sliten etter flyttingen. Ville: ned 3 kg og sove mer. Veien: 84,6 → 82,1 og morgentrening som holdt. Videre: beholde rytmen, mindre skjerm på kvelden.',
	direction: 'Mindre skjerm, mer svømming — og holde morgenrytmen gjennom vinteren.',
	changed: 'Byttet treningstid til morgenen — det forandret hele døgnet.',
	started: 'Svømming annenhver uke, og høytlesing for ungene igjen.',
	stopped: 'Skjerm i senga. Nesten.',
	memory: 'Soloppgangen på toppen av Gaustatoppen i juli, helt alene.',
	best_book: 'Stoner — John Williams',
	best_concert: 'Bon Iver i Operaen'
};

/** Statiske slide-fixtures for kavalkade-showet på /design (animate={false}) */
export const kavalkadeShowSlidesMock: ShowSlideDef[] = [
	{
		kind: 'stat',
		label: 'har du løpt',
		value: 512.4,
		decimals: 1,
		unit: 'km',
		sub: 'i fjor: 387,2 km',
		monthly: [
			{ label: 'jun', value: 18 },
			{ label: 'jul', value: 64 },
			{ label: 'aug', value: 48 },
			{ label: 'sep', value: 41 },
			{ label: 'okt', value: 39 },
			{ label: 'nov', value: 30 },
			{ label: 'des', value: 22 },
			{ label: 'jan', value: 35 },
			{ label: 'feb', value: 44 },
			{ label: 'mar', value: 52 },
			{ label: 'apr', value: 58 },
			{ label: 'mai', value: 49 },
			{ label: 'jun', value: 12 }
		],
		yearly: [
			{ label: '2022–23', value: 201 },
			{ label: '2023–24', value: 305 },
			{ label: '2024–25', value: 387 },
			{ label: '2025–26', value: 512 }
		],
		hue: 12,
		durationMs: 7500
	},
	{
		kind: 'quote',
		text: 'Et stille år er også et liv. Du har lest, du har gått, du har holdt ut.',
		attribution: 'William Stoner, «Stoner»',
		writer: 'William Stoner',
		hue: 258,
		durationMs: 8000
	},
	{
		kind: 'ordsky',
		title: 'Året i ord',
		words: kavalkadeOrdskyMock.slice(0, 12),
		hue: 152,
		durationMs: 7000
	},
	{
		kind: 'outro',
		title: 'Gratulerer med dagen! 🎂',
		sub: 'Her kommer år 42.',
		hue: 320,
		durationMs: 5500,
		confetti: true
	}
];

/** Komplett show-input for live-demoen på /design/kavalkade-show */
export const kavalkadeShowInputMock = {
	birthday: { hasBirthDate: true, daysUntil: 7, turningAge: 42 },
	windowLabels: { current: '18. juni 2025 – 17. juni 2026' },
	current: kavalkadeCurrentYearMock,
	previous: kavalkadePreviousYearMock,
	timeline: kavalkadeTimelineMock,
	ordsky: kavalkadeOrdskyMock,
	sportHistory: [
		{
			family: 'running',
			asDistance: true,
			monthly: [
				{ label: 'jun', value: 18 },
				{ label: 'jul', value: 64 },
				{ label: 'aug', value: 48 },
				{ label: 'sep', value: 41 },
				{ label: 'okt', value: 39 },
				{ label: 'nov', value: 30 },
				{ label: 'des', value: 22 },
				{ label: 'jan', value: 35 },
				{ label: 'feb', value: 44 },
				{ label: 'mar', value: 52 },
				{ label: 'apr', value: 58 },
				{ label: 'mai', value: 49 },
				{ label: 'jun', value: 12 }
			],
			yearly: [
				{ label: '2022–23', value: 201 },
				{ label: '2023–24', value: 305 },
				{ label: '2024–25', value: 387 },
				{ label: '2025–26', value: 512 }
			]
		},
		{
			family: 'walking',
			asDistance: true,
			monthly: [
				{ label: 'jun', value: 9 },
				{ label: 'jul', value: 26 },
				{ label: 'aug', value: 21 },
				{ label: 'sep', value: 17 },
				{ label: 'okt', value: 14 },
				{ label: 'nov', value: 11 },
				{ label: 'des', value: 8 },
				{ label: 'jan', value: 10 },
				{ label: 'feb', value: 13 },
				{ label: 'mar', value: 18 },
				{ label: 'apr', value: 20 },
				{ label: 'mai', value: 16 },
				{ label: 'jun', value: 6 }
			],
			yearly: [
				{ label: '2024–25', value: 201 },
				{ label: '2025–26', value: 189 }
			]
		}
	],
	interview: { thisYear: kavalkadeInterviewAnswersMock },
	prophecy:
		'Jeg ser et år der løpeskoene runder 600 km før løvet faller, og der svømmetakene du så nølende begynte med blir like selvfølgelige som morgenkaffen.\n\nKrystallkulen er klar: mer av det som virker.',
	greetings: kavalkadeGreetingsMock
};
