/**
 * Widget-data cache — stale-while-revalidate for /api/widget-data/:id
 *
 * Samme mønster som dashboard-cache.ts:
 *  1. In-memory map (tapes session, raskest)
 *  2. localStorage (overlever reload)
 *  3. Inflight-dedupl: samme ID hentes maks én gang om gangen
 *
 * HomeScreen kaller prefetchWidgetData() tidlig (når widget-IDs er kjent fra cache).
 * DynamicWidget kaller getWidgetData() på mount → in-memory treff = ingen localStorage-les.
 */

export interface WidgetData {
	current: number | null;
	sparkline: number[];
	unit: string;
	delta: number | null;
	pct: number | null;
	state: 'success' | 'warn' | 'normal';
}

interface CacheEntry {
	data: WidgetData;
	cachedAt: number; // performance.now() timestamp
}

const FRESH_MS = 60_000; // 60s — samme som dashboard-cache
const STORAGE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min for localStorage (same as DynamicWidget)
const STORAGE_KEY_PREFIX = 'resonans:home:widget-data:';
const STORAGE_KEY_VERSION = ':v1';

function storageKey(widgetId: string) {
	return `${STORAGE_KEY_PREFIX}${widgetId}${STORAGE_KEY_VERSION}`;
}

// --- In-memory store ---
const memCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<WidgetData>>();

// --- localStorage helpers ---
function readFromStorage(widgetId: string): WidgetData | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(storageKey(widgetId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { cachedAt: string; data: WidgetData };
		if (!parsed?.cachedAt || !parsed?.data) return null;
		const ageMs = Date.now() - new Date(parsed.cachedAt).getTime();
		if (!Number.isFinite(ageMs) || ageMs > STORAGE_MAX_AGE_MS) return null;
		return parsed.data;
	} catch {
		return null;
	}
}

function writeToStorage(widgetId: string, data: WidgetData) {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(
			storageKey(widgetId),
			JSON.stringify({ cachedAt: new Date().toISOString(), data })
		);
	} catch {
		// quota / private mode
	}
}

// --- Public API ---

/**
 * Henter cached widget-data uten å starte noen fetch.
 * Sjekker in-memory først, deretter localStorage.
 */
export function getCachedWidgetData(widgetId: string): WidgetData | null {
	const mem = memCache.get(widgetId);
	if (mem) return mem.data;
	const stored = readFromStorage(widgetId);
	if (stored) {
		// Varm opp in-memory fra localStorage
		memCache.set(widgetId, { data: stored, cachedAt: 0 }); // cachedAt=0 → alltid "stale" for neste fetch
	}
	return stored;
}

/**
 * Henter fersk widget-data. Deduplicerer inflight-forespørsler.
 * Oppdaterer både in-memory og localStorage.
 */
export async function fetchWidgetData(widgetId: string): Promise<WidgetData | null> {
	const existing = inflight.get(widgetId);
	if (existing) return existing;

	const promise = (async (): Promise<WidgetData> => {
		const res = await fetch(`/api/widget-data/${widgetId}`);
		if (!res.ok) throw new Error(`widget-data ${widgetId}: ${res.status}`);
		const data = (await res.json()) as WidgetData;
		memCache.set(widgetId, { data, cachedAt: performance.now() });
		writeToStorage(widgetId, data);
		return data;
	})();

	inflight.set(widgetId, promise);
	promise.finally(() => inflight.delete(widgetId));
	return promise.catch(() => null);
}

/**
 * Returnerer cached data hvis fersk nok (<60s), ellers starter ny fetch.
 * Brukes av HomeScreen for idle-prefetch.
 */
export async function prefetchWidgetData(widgetId: string): Promise<void> {
	const mem = memCache.get(widgetId);
	if (mem && performance.now() - mem.cachedAt < FRESH_MS) return; // fersk nok
	await fetchWidgetData(widgetId);
}
