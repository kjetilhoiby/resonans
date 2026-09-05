import { dashboardEndpointForTheme, type DashboardKind } from '$lib/domain/theme-dashboard-registry';
import { HEALTH_FAMILY_KINDS } from '$lib/domain/health-subthemes';
import { extractApiErrorMessage } from '$lib/client/api-error';
import type { SubthemeTile } from '$lib/domain/health/subtheme-tiles';
import type { PresentedSignal } from '$lib/domain/health/signal-presentation';
import type { TrainingDashboardPayload } from '$lib/server/training-dashboard';
import type { SleepDashboardPayload } from '$lib/server/sleep-dashboard';
import type { ScreenTimeDashboardPayload } from '$lib/server/screentime-dashboard';
import type { NutritionDashboardPayload } from '$lib/server/nutrition-dashboard';
import type { WeightDashboardPayload } from '$lib/server/weight-dashboard';
import type { WritingDashboardPayload } from '$lib/server/writing-dashboard';

export interface HealthDashboardData {
	weekly: unknown[];
	monthly: unknown[];
	yearly: unknown[];
	/** Undertema-stripen. Valgfri: en cachet payload fra før splitten mangler den. */
	subthemes?: SubthemeTile[];
	signals?: PresentedSignal[];
	sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
	/**
	 * Vekt- og øktshendelser for målberegningene i Mål-fanen. IKKE en
	 * hendelsesdump til visning — den bor på Trening. Se `loadGoalEvents`.
	 */
	recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
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
		/** Flyttet mellom egne kontoer. Holdt utenfor totalSpending, men vist så tallet ikke forsvinner. */
		internalTransferTotal?: number;
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
		inferredPaydayDates: string[];
		comparisonDays: number;
		longestComparisonPeriodDays: number;
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

export interface FilmDashboardData {
	themeName: string;
	themeEmoji: string | null;
	totalFilms: number;
	wantToWatch: number;
	watched: number;
	listCount: number;
	films: Array<{
		id: string;
		title: string;
		year: number | null;
		director: string | null;
		status: string;
		rating: number | null;
		posterUrl: string | null;
		contextStatus: string;
		watchedAt: string | null;
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
		isStaple?: boolean;
	}>;
	expiringSoon: Array<{
		id: string;
		name: string;
		location: 'pantry' | 'fridge' | 'freezer';
		quantity: string | null;
		unit: string | null;
		expiresAt: string | null;
	}>;
	shoppingList?: FoodShoppingListSummary | null;
	groceryBudgetWeekly?: number | null;
	weekRhythmNote?: string | null;
	onboarded?: boolean;
	nextWeek?: {
		weekContext: string;
		mealPlans: FoodDashboardData['mealPlans'];
		shoppingList?: FoodShoppingListSummary | null;
	};
	/** Matpakke-data (DEL B) — optional så eldre cache-payloads ikke brekker. */
	lunchbox?: unknown;
	groceryOrders?: unknown;
}

export interface FoodShoppingListSummary {
	id: string;
	status: string;
	itemCount: number;
	uncheckedCount: number;
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
	chores: {
		stats: { gross: number; completed: number; windowDays: number };
		checklistId: string | null;
		items: Array<{
			id: string;
			checklistId: string;
			text: string;
			appliance: string | null;
			cycleId: string | null;
			createdAt: string;
		}>;
	};
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
		vacuum: {
			isRunning: boolean;
			state: string | null;
			battery: number | null;
			cleanMinutes: number | null;
			cleanAreaM2: number | null;
			cleanPercent: number | null;
			lastClean: {
				at: string;
				areaM2: number | null;
				durationMinutes: number | null;
				cleanType: string | null;
				mapName: string | null;
				complete: boolean | null;
			} | null;
		} | null;
	}>;
	climate: Array<{
		room: string;
		latest: {
			timestamp: string;
			temperatureC: number;
			humidityPct: number | null;
			targetTemperatureC: number | null;
			heating: boolean | null;
		};
		series: Array<{ timestamp: string; temperatureC: number }>;
	}>;
}

export interface VehicleDashboardData {
	connected: boolean;
	hourly: Array<{ key: string; km: number }>;
	costPerKm: Array<{ month: string; km: number; cost: number; krPerKm: number | null }>;
	positions: Array<{
		lat: number;
		lon: number;
		kind: 'stop' | 'move';
		from: string;
		to: string;
		samples: number;
	}>;
	generatedAt: string;
}

// Helse-undertemaene. Formen kommer fra lasterne i $lib/server — `import type`
// er erasert av verbatimModuleSyntax, så dette drar ikke serverkode til klienten
// (samme mønster som ProjectProgress i HomeDashboard).
type DashboardPayloadMap = {
	health: HealthDashboardData;
	training: TrainingDashboardPayload;
	sleep: SleepDashboardPayload;
	screentime: ScreenTimeDashboardPayload;
	nutrition: NutritionDashboardPayload;
	weight: WeightDashboardPayload;
	writing: WritingDashboardPayload;
	economics: EconomicsDashboardData;
	food: FoodDashboardData;
	travel: TravelDashboardData;
	ferie: { themeName: string; themeEmoji: string | null; status: string };
	books: BooksDashboardData;
	film: FilmDashboardData;
	family: FamilyDashboardData;
	egenfrekvens: EgenfrekvensDashboardData;
	home: HomeDashboardData;
	vehicle: VehicleDashboardData;
};

export interface DashboardCacheEntry<K extends DashboardKind = DashboardKind> {
	kind: K;
	themeId: string;
	data: DashboardPayloadMap[K];
	cachedAt: string;
}

// v4: helse-payloaden fikk undertema-stripe og signaler, og mistet felter da
// detaljene flyttet til undertemaene. getCachedDashboard returnerer lagret
// innhold uansett alder og maler det før refetch, så en gammel payload måtte
// ut — ellers ville første maling vist forrige versjon av flaten.
const CACHE_PREFIX = 'resonans:dashboard:v4:';
const STALE_CACHE_PREFIXES = ['resonans:dashboard:v3:'];
const memoryCache = new Map<string, DashboardCacheEntry>();
const inflightRequests = new Map<string, Promise<DashboardCacheEntry>>();

/** Rydder nøkler fra tidligere cache-versjoner. En bump alene frigjør ikke
 *  plassen, og helse-payloaden var stor (inntil 2000 økter + 500 hendelser). */
function purgeStaleCacheVersions(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key && STALE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
				localStorage.removeItem(key);
			}
		}
	} catch {
		/* private mode / full kvote — ikke verdt å feile på */
	}
}

purgeStaleCacheVersions();

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
			// Ikke rå kroppen: den kan være en hel HTML-feilside. Kallstedet viser
			// meldingen, så den må være lesbar.
			throw new Error(extractApiErrorMessage(response.status, await response.text()));
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

/**
 * Tøm cachen for hele helse-familien.
 *
 * Etter mortema-splitten ligger data som én mutasjon påvirker spredt: en økt
 * endrer både aktivitetslista på Trening og undertema-stripen på mor. Å
 * invalidere bare 'health' ville latt Trening vise den skjulte økta videre —
 * nøyaktig regresjonen invalidateDashboardKind ble innført for å fikse.
 *
 * ## Hvorfor lista ikke skrives her
 *
 * Den gjorde det, og da gjentok regresjonen seg: da Vekt ble eget undertema i
 * august 2026, ble 'weight' lagt til i `HEALTH_SUBTHEMES` og glemt her. Alle tre
 * kallstedene trodde de hadde tømt helse-familien, mens vektflaten fortsatte å
 * male fra cache. `HEALTH_FAMILY_KINDS` er derivert av det lukkede settet, så et
 * nytt undertema følger med av seg selv.
 */
export function invalidateHealthFamily(): void {
	for (const kind of HEALTH_FAMILY_KINDS) {
		invalidateDashboardKind(kind);
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