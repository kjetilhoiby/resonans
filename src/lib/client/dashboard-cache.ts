import { dashboardEndpointForTheme, type DashboardKind } from '$lib/domain/theme-dashboard-registry';

export interface WorkoutActivity {
	activityId: string;
	startTime: string;
	sportType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	sources: string[];
	evidence: Array<{
		eventId: string;
		hasTrackPoints: boolean;
		provider: string;
		sensorType: string;
		distanceMeters: number | null;
		durationSeconds: number | null;
		avgHeartRate: number | null;
	}>;
}

export interface HealthDashboardData {
	weekly: unknown[];
	monthly: unknown[];
	yearly: unknown[];
	sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
	recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
	activityLayer?: { workouts: WorkoutActivity[] };
}

export interface EconomicsDashboardData {
	accounts: Array<{ accountId: string; accountName: string | null; accountType: string | null; balance: number; currency: string | null }>;
	totalBalance: number;
	currentMonth: string;
	monthSpending: {
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
		categories: Array<{ category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }>;
	};
	recentTransactions: Array<{ date: string; description: string; amount: number; emoji: string; label: string }>;
	paydaySpend: {
		paydayDate: string | null;
		daysSincePayday: number;
		totalSpend: number;
		spendPerDay: number;
		grocerySpend: number;
		grocerySpendPerDay: number;
		prevSpendPerDay: number | null;
		prevGrocerySpendPerDay: number | null;
		transactions: Array<{ date: string; description: string; amount: number; category: string; emoji: string; label: string }>;
		groceryTransactions: Array<{ date: string; description: string; amount: number; category: string; emoji: string; label: string }>;
	};
}

export interface TravelDashboardData {
	themeName: string;
	themeEmoji: string | null;
	status: string;
}

export interface BooksDashboardData {
	themeName: string;
	themeEmoji: string | null;
	totalBooks: number;
	reading: number;
	completed: number;
	books: Array<{
		id: string;
		title: string;
		author: string | null;
		status: string;
		currentPage: number;
		totalPages: number | null;
		contextStatus: string;
		startedAt: string | null;
		finishedAt: string | null;
		createdAt: string;
	}>;
}

type DashboardPayloadMap = {
	health: HealthDashboardData;
	economics: EconomicsDashboardData;
	travel: TravelDashboardData;
	books: BooksDashboardData;
};

export interface DashboardCacheEntry<K extends DashboardKind = DashboardKind> {
	kind: K;
	themeId: string;
	data: DashboardPayloadMap[K];
	cachedAt: string;
}

const CACHE_PREFIX = 'resonans:dashboard:';
const memoryCache = new Map<string, DashboardCacheEntry>();
const inflightRequests = new Map<string, Promise<DashboardCacheEntry>>();

function getCacheKey(themeId: string, kind: DashboardKind): string {
	return `${themeId}:${kind}`;
}

function getStorageKey(themeId: string, kind: DashboardKind): string {
	return `${CACHE_PREFIX}${themeId}:${kind}`;
}

function isBrowser(): boolean {
	return typeof window !== 'undefined';
}

function readStoredEntry<K extends DashboardKind>(themeId: string, kind: K): DashboardCacheEntry<K> | null {
	if (!isBrowser()) return null;

	try {
		const raw = window.localStorage.getItem(getStorageKey(themeId, kind));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as DashboardCacheEntry<K>;
		if (!parsed?.data || typeof parsed.cachedAt !== 'string') return null;
		return parsed;
	} catch {
		return null;
	}
}

function persistEntry(entry: DashboardCacheEntry): void {
	memoryCache.set(getCacheKey(entry.themeId, entry.kind), entry);
	if (!isBrowser()) return;

	try {
		window.localStorage.setItem(getStorageKey(entry.themeId, entry.kind), JSON.stringify(entry));
	} catch {
		// Ignore storage quota or serialization failures.
	}
}

export function getCachedDashboard<K extends DashboardKind>(themeId: string, kind: K): DashboardCacheEntry<K> | null {
	const key = getCacheKey(themeId, kind);
	const inMemory = memoryCache.get(key) as DashboardCacheEntry<K> | undefined;
	if (inMemory) return inMemory;

	const stored = readStoredEntry(themeId, kind);
	if (stored) {
		memoryCache.set(key, stored);
		return stored;
	}

	return null;
}

export async function fetchDashboard<K extends DashboardKind>(themeId: string, kind: K, force = false): Promise<DashboardCacheEntry<K>> {
	const key = getCacheKey(themeId, kind);
	if (!force) {
		const inflight = inflightRequests.get(key) as Promise<DashboardCacheEntry<K>> | undefined;
		if (inflight) return inflight;
	}

	const request = (async () => {
		const response = await fetch(dashboardEndpointForTheme(themeId, kind));
		if (!response.ok) {
			throw new Error(await response.text());
		}

		const data = (await response.json()) as DashboardPayloadMap[K];
		const entry: DashboardCacheEntry<K> = {
			themeId,
			kind,
			data,
			cachedAt: new Date().toISOString()
		};

		persistEntry(entry);
		return entry;
	})();

	inflightRequests.set(key, request as Promise<DashboardCacheEntry>);

	try {
		return await request;
	} finally {
		inflightRequests.delete(key);
	}
}

export function prefetchDashboard<K extends DashboardKind>(themeId: string, kind: K): Promise<DashboardCacheEntry<K>> {
	const cached = getCachedDashboard(themeId, kind);
	if (cached) {
		const age = Date.now() - new Date(cached.cachedAt).getTime();
		if (age < 60_000) {
			return Promise.resolve(cached);
		}
	}

	return fetchDashboard(themeId, kind, false);
}