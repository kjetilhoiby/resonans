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
	dailyEffort?: Array<{ date: string; effort: number }>;
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
	recentTransactions: Array<{ date: string; description: string; amount: number; category: string; emoji: string; label: string }>;
	paydaySpend: {
		paydayDate: string | null;
		daysSincePayday: number;
		totalSpend: number;
		spendPerDay: number;
		grocerySpend: number;
		grocerySpendPerDay: number;
		prevSpendPerDay: number | null;
		prevGrocerySpendPerDay: number | null;
		comparisonPeriodsUsed: number;
		averageComparisonPoints: Array<{ day: number; total: number; grocery: number }>;
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

export interface FoodDashboardData {
	weekContext: string;
	mealPlans: Array<{
		id: string;
		date: string;
		mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
		mealId: string | null;
		notes: string | null;
		servings: number;
		photoUrl: string | null;
		mealTitle?: string | null;
	}>;
	pantry: Array<{
		id: string;
		name: string;
		location: 'pantry' | 'fridge' | 'freezer';
		quantity: string | null;
		unit: string | null;
		expiresAt: string | null;
	}>;
	expiringSoon: Array<{
		id: string;
		name: string;
		location: 'pantry' | 'fridge' | 'freezer';
		quantity: string | null;
		unit: string | null;
		expiresAt: string | null;
	}>;
}

export interface EgenfrekvensReflectionMessageData {
	role: 'user' | 'assistant';
	text: string;
}

export interface EgenfrekvensSlotPointData {
	eventId: string;
	mode: 'quick' | 'full';
	level: number | null;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	reflectionThread?: EgenfrekvensReflectionMessageData[] | null;
	reflectionSynthesis?: string | null;
	extreme: boolean;
	timestamp: string;
}

export interface EgenfrekvensCheckinPointData {
	day: string;
	count: number;
	morning: EgenfrekvensSlotPointData | null;
	evening: EgenfrekvensSlotPointData | null;
	/** Nyeste registrering pr. periode-slot (natt/morgen/arbeidsdag/ettermiddag/kveld) */
	slots?: Partial<Record<import('$lib/domains/egenfrekvens/period-slots').PeriodSlotId, EgenfrekvensSlotPointData>>;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	reflectionThread?: EgenfrekvensReflectionMessageData[] | null;
	reflectionSynthesis?: string | null;
	extreme: boolean;
	eventIds?: string[];
}

export interface EgenfrekvensDashboardData {
	rangeDays: number;
	latest: EgenfrekvensCheckinPointData | null;
	points: EgenfrekvensCheckinPointData[];
	stats: {
		count: number;
		avgBalance: number | null;
		avgLevel: number | null;
		avgThoughts: number | null;
		avgFeelings: number | null;
		avgActions: number | null;
		avgLevelBySlot?: Record<import('$lib/domains/egenfrekvens/period-slots').PeriodSlotId, number | null>;
		extremeDays: number;
	};
	streakDays: number;
}

export interface FamilyDashboardData {
	tree: {
		self: { id: 'self'; label: string };
		nodes: Array<{
			id: string;
			name: string;
			kind: string;
			avatarEmoji: string | null;
			photoUrl: string | null;
			birthDate: string | null;
			archived: boolean;
		}>;
		edges: Array<{
			id: string;
			fromPersonId: string | null;
			toPersonId: string;
			relationType: 'family' | 'friend' | 'work';
			subType: string | null;
			closeness: number | null;
		}>;
		byKind: Record<string, Array<{ id: string; name: string; avatarEmoji: string | null; photoUrl: string | null; birthDate: string | null; archived: boolean; kind: string }>>;
		byRelationType: Record<'family' | 'friend' | 'work', Array<{ id: string; name: string; avatarEmoji: string | null; photoUrl: string | null; birthDate: string | null; archived: boolean; kind: string }>>;
	};
	persons: Array<{
		id: string;
		name: string;
		kind: string;
		avatarEmoji: string | null;
		photoUrl: string | null;
		birthDate: string | null;
		archived: boolean;
	}>;
	relations: Array<{
		id: string;
		fromPersonId: string | null;
		toPersonId: string;
		relationType: 'family' | 'friend' | 'work';
		subType: string | null;
		closeness: number | null;
	}>;
	recentMemoriesByPerson: Record<string, Array<{
		id: string;
		content: string;
		category: string;
		importance: string;
		createdAt: string;
	}>>;
	openGoalsByPerson: Record<string, Array<{
		id: string;
		title: string;
		description: string | null;
		targetDate: string | null;
		createdAt: string;
	}>>;
	upcomingEventsByPerson: Record<string, Array<{
		id: string;
		title: string;
		startTimestamp: string | null;
		groupName: string | null;
	}>>;
	conversationsByPerson: Record<string, Array<{
		id: string;
		title: string | null;
		updatedAt: string;
	}>>;
	tasksByPerson: Record<string, Array<{
		id: string;
		title: string;
		status: string;
		frequency: string | null;
		createdAt: string;
	}>>;
	feed: FamilyFeedItem[];
	ferieThemes: Array<{
		id: string;
		name: string;
		emoji: string | null;
		startDate: string | null;
		endDate: string | null;
		note: string | null;
	}>;
}

export type FamilyFeedItem =
	| {
			kind: 'event';
			id: string;
			personIds: string[];
			ts: string;
			title: string;
			groupName: string | null;
			future: boolean;
	  }
	| {
			kind: 'task';
			id: string;
			personIds: string[];
			ts: string;
			title: string;
			status: string;
			source: 'direct' | 'mention';
			confidence: 'explicit' | 'inferred' | null;
	  }
	| {
			kind: 'message-mention';
			id: string;
			personIds: string[];
			ts: string;
			conversationId: string;
			snippet: string;
			role: string;
			confidence: 'explicit' | 'inferred';
	  }
	| {
			kind: 'checklist-mention';
			id: string;
			personIds: string[];
			ts: string;
			text: string;
			checked: boolean;
			confidence: 'explicit' | 'inferred';
	  };

export interface HomeDashboardData {
	projects: Array<{
		id: string;
		title: string;
		description?: string | null;
		domain: string | null;
		type: string | null;
		status: string;
		metadata: Record<string, unknown>;
		progress: import('$lib/server/services/project-metrics-service').ProjectProgress | null;
	}>;
	projectThemes: Array<{
		id: string;
		name: string;
		emoji: string | null;
		room: string | null;
		status: string | null;
		targetDate: string | null;
		tasksTotal: number;
		tasksDone: number;
	}>;
	seasonalTasks: Array<{
		id: string;
		title: string;
		season: string | null;
		recurrenceYearly: boolean;
		status: string;
	}>;
	routines: Array<{
		id: string;
		title: string;
		emoji: string;
		completedAt: Date | string | null;
	}>;
	appliances: Array<{
		sensorId: string;
		subtype: string;
		name: string;
		label: string;
		emoji: string;
		recentEvents: Array<{
			id: string;
			eventType: string;
			dataType: string;
			timestamp: string;
			data: Record<string, unknown>;
		}>;
		cycle: {
			curve: number[];
			peakWatts: number;
			elapsedMinutes: number;
			totalMinutes: number;
			remainingMinutes: number;
			finishAt: string | null;
			programName: string | null;
			isRunning: boolean;
		} | null;
	}>;
}

type DashboardPayloadMap = {
	health: HealthDashboardData;
	economics: EconomicsDashboardData;
	food: FoodDashboardData;
	travel: TravelDashboardData;
	ferie: { themeName: string; themeEmoji: string | null; status: string };
	books: BooksDashboardData;
	family: FamilyDashboardData;
	egenfrekvens: EgenfrekvensDashboardData;
	home: HomeDashboardData;
};

export interface DashboardCacheEntry<K extends DashboardKind = DashboardKind> {
	kind: K;
	themeId: string;
	data: DashboardPayloadMap[K];
	cachedAt: string;
}

const CACHE_PREFIX = 'resonans:dashboard:v3:';
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

export function invalidateDashboardKind(kind: DashboardKind): void {
	for (const [key] of memoryCache) {
		if (key.endsWith(`:${kind}`)) memoryCache.delete(key);
	}
	if (!isBrowser()) return;
	for (let i = localStorage.length - 1; i >= 0; i--) {
		const k = localStorage.key(i);
		if (k?.startsWith(CACHE_PREFIX) && k.endsWith(`:${kind}`)) localStorage.removeItem(k);
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