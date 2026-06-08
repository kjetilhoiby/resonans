/**
 * Data-fetching og caching for hjemskjermen.
 *
 * Eksporterer rene funksjoner som tar minimal input og returnerer typed data.
 * HomeScreen kaller disse og skriver resultatet til $state-variabler.
 */

import type { Checklist } from '../../composed/ChecklistWidget.svelte';
import type { ActionCandidate } from '$lib/types/actions';
import type {
	SensorSummary,
	UserWidget,
	MediaHistoryItem,
	EgenfrekvensSlotSummary,
	EgenfrekvensRecentPoint,
} from './home-context';

// ── Dato-hjelpere ───────────────────────────────────────────────────────

export function toLocalIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function toLocalYearMonth(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	return `${year}-${month}`;
}

export function getLocalIsoWeekDashed(now: Date = new Date()): string {
	const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');
	return `${year}-W${week}`;
}

export function getMonthDayContexts(year: number, month: number): string[] {
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

// ── LocalStorage cache ──────────────────────────────────────────────────

export const HOME_SENSOR_CACHE_KEY = 'resonans:home:sensor-summary:v1';
export const HOME_PINNED_WIDGETS_CACHE_KEY = 'resonans:home:pinned-widgets:v1';
export const HOME_SENSOR_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
export const HOME_PINNED_WIDGETS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

interface CachedPayload<T> {
	cachedAt: string;
	data: T;
}

export function readCachedPayload<T>(key: string, maxAgeMs: number): T | null {
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

export function writeCachedPayload<T>(key: string, data: T): void {
	if (typeof window === 'undefined') return;
	try {
		const payload: CachedPayload<T> = {
			cachedAt: new Date().toISOString(),
			data
		};
		window.localStorage.setItem(key, JSON.stringify(payload));
	} catch { /* ignorer */ }
}

// ── Checklist-sortering ─────────────────────────────────────────────────

export function sortActiveChecklists(rows: Checklist[]): Checklist[] {
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

// ── Sjekkliste-kontekst fra dato ────────────────────────────────────────

export function getDateFromChecklistContext(context: string | null): string | null {
	if (!context) return null;
	const m = context.match(/^week:\d{4}-W\d{2}:day:(\d{4}-\d{2}-\d{2})$/);
	return m?.[1] ?? null;
}

// ── Data-fetching ───────────────────────────────────────────────────────

export interface ChecklistData {
	activeChecklists: Checklist[];
	allContextChecklists: Checklist[];
	monthDayChecklists: Checklist[];
	monthMetrics: { effort: Record<string, number>; egenfrekvens: Record<string, number> } | null;
	todaysRoutines: Array<{
		checklistId: string;
		title: string;
		emoji: string;
		slot: string;
		items: Array<{ id: string; text: string; checked: boolean; sortOrder: number; estimateMinutes: number | null }>;
	}>;
}

export async function fetchChecklistData(): Promise<ChecklistData> {
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

	const metricsPromise = fetch(
		`/api/home/month-metrics?month=${encodeURIComponent(monthContext.slice('month:'.length))}`
	).then(async (res) => {
		if (!res.ok) return null;
		return (await res.json()) as {
			effort: Record<string, number>;
			egenfrekvens: Record<string, number>;
		};
	});

	const routinePromise = fetch('/api/routines/today').then(async (res) => {
		if (!res.ok) return null;
		return (await res.json()) as Array<{
			definition: { id: string; title: string; emoji: string; slot: string };
			checklistId: string;
			date: string;
			items: Array<{ id: string; text: string; checked: boolean; sortOrder: number; estimateMinutes: number | null }>;
			completedAt: string | null;
		}>;
	});

	const [activeRows, contextRows, metrics, routineRows] = await Promise.all([
		activePromise,
		monthDayPromise,
		metricsPromise,
		routinePromise
	]);

	const result: ChecklistData = {
		activeChecklists: activeRows ? sortActiveChecklists(activeRows) : [],
		allContextChecklists: contextRows ?? [],
		monthDayChecklists: (contextRows ?? []).filter((c) =>
			(c.context ?? '').startsWith('week:') && (c.context ?? '').includes(':day:')
		),
		monthMetrics: metrics ? { effort: metrics.effort ?? {}, egenfrekvens: metrics.egenfrekvens ?? {} } : null,
		todaysRoutines: routineRows
			? routineRows.map((r) => ({
					checklistId: r.checklistId,
					title: r.definition.title,
					emoji: r.definition.emoji,
					slot: r.definition.slot,
					items: r.items
				}))
			: []
	};

	return result;
}

export interface SensorWidgetData {
	sensorSummary: SensorSummary | null;
	pinnedWidgets: UserWidget[];
	hiddenWidgets: UserWidget[];
}

export async function fetchSensorAndWidgets(): Promise<SensorWidgetData> {
	const [summaryRes, widgetsRes] = await Promise.all([
		fetch('/api/sensor-summary'),
		fetch('/api/user-widgets')
	]);

	let sensorSummary: SensorSummary | null = null;
	let pinnedWidgets: UserWidget[] = [];
	let hiddenWidgets: UserWidget[] = [];

	if (summaryRes.ok) {
		sensorSummary = await summaryRes.json();
	}
	if (widgetsRes.ok) {
		const allWidgets = await widgetsRes.json();
		pinnedWidgets = allWidgets.filter((w: UserWidget) => w.pinned);
		hiddenWidgets = allWidgets.filter((w: UserWidget) => !w.pinned);
	}

	return { sensorSummary, pinnedWidgets, hiddenWidgets };
}

export async function loadActionCandidates(): Promise<ActionCandidate[]> {
	try {
		const res = await fetch('/api/home/actions');
		if (!res.ok) return [];
		const body = (await res.json()) as { items?: ActionCandidate[] };
		return body.items ?? [];
	} catch {
		return [];
	}
}

export interface EgenfrekvensRecentData {
	today: { morning: EgenfrekvensSlotSummary | null; evening: EgenfrekvensSlotSummary | null };
	points: EgenfrekvensRecentPoint[];
	settings: { enabled: boolean; morningTime: string; eveningTime: string } | null;
}

export async function loadEgenfrekvensRecent(): Promise<EgenfrekvensRecentData | null> {
	try {
		const res = await fetch('/api/egenfrekvens/recent?days=7');
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

export async function fetchMediaHistory(kind: 'image' | 'audio' | 'document'): Promise<MediaHistoryItem[]> {
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

export interface WeekPlanContext {
	currentWeekKey: string;
	currentWeekNo: number;
	prevWeekKey: string;
	prevWeekNo: number;
	note: string;
	reflection: string;
	uncheckedItems: Array<{ id: string; text: string }>;
	weekGoals: Array<{
		title: string;
		currentValue: number;
		target: { value: number; unit: string };
		trackingMetric: string;
	}>;
	recurringTasks: string[];
}

export async function fetchWeekPlanContext(weekKey: string): Promise<WeekPlanContext | null> {
	try {
		const res = await fetch(`/api/week-plan/context?week=${encodeURIComponent(weekKey)}`);
		if (!res.ok) return null;
		return (await res.json()) as WeekPlanContext;
	} catch {
		return null;
	}
}

export interface MonthPlanContext {
	currentMonthKey: string;
	currentMonthName: string;
	prevMonthKey: string;
	prevMonthName: string;
	note: string;
	reflection: string;
	uncheckedItems: Array<{ id: string; text: string }>;
	monthGoals: Array<{
		title: string;
		currentValue: number;
		target: { value: number; unit: string };
		trackingMetric: string;
	}>;
	recurringTasks: string[];
}

export async function fetchMonthPlanContext(monthKey: string): Promise<MonthPlanContext | null> {
	try {
		const res = await fetch(`/api/month-plan/context?month=${encodeURIComponent(monthKey)}`);
		if (!res.ok) return null;
		return (await res.json()) as MonthPlanContext;
	} catch {
		return null;
	}
}

export function buildWeekPlanFlowContext(ctx: WeekPlanContext): import('$lib/flows/types').FlowContext {
	const goalLines = ctx.weekGoals.map((g) => {
		const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
		return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pct !== null ? ` (${pct}%)` : ''}`;
	}).join('\n');

	return {
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
			refleksjon: [
				`Brukeren er klar for å planlegge uke ${ctx.currentWeekNo}.`,
				`\nForrige uke (uke ${ctx.prevWeekNo}):`,
				ctx.note ? `Ukesnotat: "${ctx.note}"` : '',
				ctx.reflection ? `Refleksjon: "${ctx.reflection}"` : '',
				goalLines ? `\nMål:\n${goalLines}` : '',
				'\nGi en kort, varm oppsummering av forrige uke (2-3 setninger). Avslutt med ett åpent spørsmål om hva som gikk bra og hva som var utfordrende.'
			].filter(Boolean).join('\n'),
			maal: [
				`Du hjelper brukeren å sette ukesmål for uke ${ctx.currentWeekNo}.`,
				goalLines ? `\nForrige ukes mål og fremgang (uke ${ctx.prevWeekNo}):\n${goalLines}` : '\nIngen mål fra forrige uke.',
				'\nSkille mellom mål og oppgaver:',
				'- UKESMÅL: kun for ting med målbar fremdrift mot et tall (f.eks. løping i km, antall treningsøkter, vekt i kg). Hold listen kort.',
				'- UKESOPPGAVER: konkrete ting du gjør 1–7 ganger denne uka (handle, planleggingsprat, sjekke noe, møte osv.).',
				'\nGå gjennom forrige ukes mål. Foreslå om hvert bør videreføres eller justeres. Kom gjerne med nye oppgaver basert på refleksjonen.',
				'\nAvslutt alltid med begge listene (utelat seksjoner som ikke passer):',
				'\nUKESMÅL:',
				'- [tittel]: [verdi] [enhet]',
				'\nUKESOPPGAVER:',
				'- [tittel]: [antall] [enhet]'
			].filter(Boolean).join('\n'),
			ukeshistorie: [
				`Du hjelper brukeren å skrive en kort ukesbeskrivelse for uke ${ctx.currentWeekNo}.`,
				`Spør: "Hva handler uke ${ctx.currentWeekNo} om for deg?"`,
				'Basert på svaret, skriv et kort utkast (1-2 setninger). Vær personlig og konkret.',
				'La brukeren justere utkastet via chat. Avslutt med det endelige notatet.'
			].join('\n')
		}
	};
}

export function buildMonthPlanFlowContext(ctx: MonthPlanContext): import('$lib/flows/types').FlowContext {
	const goalLines = ctx.monthGoals.map((g) => {
		const pct = g.target.value > 0 ? Math.round((g.currentValue / g.target.value) * 100) : null;
		return `- ${g.title}: ${g.currentValue} av ${g.target.value} ${g.target.unit}${pct !== null ? ` (${pct}%)` : ''}`;
	}).join('\n');

	return {
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
}

export async function loadEgenfrekvensContext(activeSlot: 'morning' | 'evening'): Promise<{
	reflectionPrompt: string | null;
	dreamReasons: Record<string, Array<{ value: string; label: string; source: string }>> | null;
}> {
	const isoDay = new Date().toISOString().slice(0, 10);
	const slotQuery = activeSlot ? `&slot=${activeSlot}` : '';
	let reflectionPrompt: string | null = null;
	let dreamReasons: Record<string, Array<{ value: string; label: string; source: string }>> | null = null;

	await Promise.all([
		fetch(`/api/egenfrekvens/reflection-context?day=${isoDay}${slotQuery}`)
			.then((r) => r.ok ? r.json() : null)
			.then((ctx) => {
				reflectionPrompt = typeof ctx?.systemPrompt === 'string' ? ctx.systemPrompt : null;
			})
			.catch(() => { reflectionPrompt = null; }),
		fetch('/api/egenfrekvens/dream-reasons')
			.then((r) => r.ok ? r.json() : null)
			.then((reasons) => { dreamReasons = reasons; })
			.catch(() => { dreamReasons = null; })
	]);

	return { reflectionPrompt, dreamReasons };
}

export async function fetchQuickWinItems(): Promise<Array<{ id: string; text: string }>> {
	try {
		const res = await fetch('/api/checklists/open-items?limit=20');
		if (!res.ok) return [];
		const body = (await res.json()) as {
			items?: Array<{ id: string; text: string; checklistTitle: string }>;
		};
		return (body.items ?? []).map((i) => ({
			id: i.id,
			text: i.checklistTitle ? `${i.text}  ·  ${i.checklistTitle}` : i.text
		}));
	} catch {
		return [];
	}
}

// ── Widget prefetch scheduler ──────────────────────────────────────────

export function scheduleWidgetDataPrefetch(
	widgets: UserWidget[],
	prefetchFn: (id: string) => void
): void {
	if (widgets.length === 0 || typeof window === 'undefined') return;
	const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
	if (connection?.saveData) return;
	if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return;
	const ids = widgets.slice(0, 3).map((w) => w.id);
	const run = () => {
		for (const id of ids) void prefetchFn(id);
	};
	if ('requestIdleCallback' in window) {
		window.requestIdleCallback(run, { timeout: 1200 });
	} else {
		setTimeout(run, 100);
	}
}

// ── Widget-paginering ──────────────────────────────────────────────────

export function chunkWidgets<T>(rows: T[], size: number): T[][] {
	if (rows.length === 0) return [[]];
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += size) {
		chunks.push(rows.slice(i, i + size));
	}
	return chunks;
}

export const WIDGETS_PER_PAGE = 6;
