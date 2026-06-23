/**
 * Nettverks-IO for reiseflaten (TripDashboard, TripBudget, TripListsPanel,
 * TripDayCalendar, TripHealthStats, FerieDashboard, FerieGridView,
 * FerieExecutionView, TripPlanningSection) — samlet bak ett interface slik at
 * /design kan injisere en mock og rendre komponentene uten nettverk.
 *
 * Delte typer som brukes på tvers av reise-komponentene bor også her.
 */

import { patchItem, deleteItem, addItems } from '$lib/utils/checklist-api';
import { fetchRawTimeseries, fetchOpenMeteoDay } from '$lib/utils/weather';

/* ── Delte typer: reiseprofil ────────────────────────── */

export interface OvernightStay {
	id: string;
	name: string;
	checkIn: string;
	checkOut: string;
	refNumber?: string;
	lockCode?: string;
	address?: string;
	notes?: string;
}

export interface DayGeo {
	place?: string;
	lat?: number;
	lon?: number;
	source: 'observed' | 'declared' | 'overnight';
	liveSessionId?: string;
}

/** Et bilde plassert som nål på et fritt punkt i kartfortellingen. */
export interface ImagePin {
	id: string;
	url: string;
	lat: number;
	lon: number;
	caption?: string;
	/** ISO-dato bildet hører til (valgfritt). */
	date?: string;
}

export interface TripProfile {
	destination?: string;
	country?: string;
	lat?: number;
	lng?: number;
	startDate?: string;
	endDate?: string;
	accountIds?: string[];
	overnightStays?: OvernightStay[];
	/** Geo-kontekst turen har akkumulert, per ISO-dato. Skrives av live-session-flyten. */
	geoByDay?: Record<string, DayGeo>;
	/** Bilder plassert som nåler på kartet (kartfortelling). */
	imagePins?: ImagePin[];
}

/* ── Delte typer: ferieprofil ────────────────────────── */

export type FerieRole = 'voksen' | 'barn';

export interface FerieMember {
	id: string;
	personId?: string;
	name: string;
	role: FerieRole;
}

export interface FerieTripStop {
	id: string;
	place: string;
	lat?: number;
	lon?: number;
	startDate: string;
	endDate: string;
	weatherEmoji?: string;
	weatherTemp?: number;
	weatherFetchedAt?: string;
}

export interface FerieTrip {
	id: string;
	label: string;
	place?: string;
	startDate?: string;
	endDate?: string;
	linkedThemeId?: string;
	participants?: string[];
	stops?: FerieTripStop[];
}

export interface FerieCell {
	status: string;
	label?: string;
}

export interface FerieProfile {
	startDate?: string;
	endDate?: string;
	note?: string;
	members?: FerieMember[];
	grid?: Record<string, Record<string, FerieCell>>;
	trips?: FerieTrip[];
	/** Antall udekkede barn-dager brukeren har avvist. Påminnelsen vises igjen
	 *  hvis antallet endrer seg fra dette. */
	gapAckCount?: number;
}

/** Payload for PUT /api/tema/:id/ferie (null-felter tømmer verdien). */
export interface FerieProfilePayload {
	startDate: string | null;
	endDate: string | null;
	note: string | null;
	members: FerieMember[];
	grid: Record<string, Record<string, FerieCell>>;
	trips: FerieTrip[];
	gapAckCount: number | null;
}

/* ── Delte typer: vær og geografi ────────────────────── */

export interface GeoPoint {
	lat: number;
	lon: number;
}

/** Rå entry fra api.met.no locationforecast compact-timeseries. */
export interface MetTimeseriesEntry {
	time: string;
	data: {
		instant: { details: { air_temperature: number; wind_speed: number } };
		next_1_hours?: {
			summary?: { symbol_code?: string };
			details?: { precipitation_amount?: number };
		};
		next_6_hours?: {
			summary?: { symbol_code?: string };
			details?: {
				air_temperature_max?: number;
				air_temperature_min?: number;
				precipitation_amount?: number;
			};
		};
	};
}

/** Aggregert dagsprognose (TripDashboard → TripDayCalendar). */
export interface DayForecast {
	date: string; // YYYY-MM-DD
	symbolCode: string;
	tempMin: number;
	tempMax: number;
	wind: number; // maks m/s for dagen
	precipitation: number; // total mm
}

/* ── Delte typer: økonomi ────────────────────────────── */

export interface BankAccount {
	id: string;
	name: string | null;
}

export interface Transaction {
	id: string;
	date: string;
	accountId: string | null;
	amount: number;
	description: string;
	category: string;
	label: string | null;
	emoji: string | null;
}

export interface TransactionQuery {
	from?: string;
	to?: string;
	search?: string;
	accountIds?: string[];
}

export interface TransactionsResult {
	transactions: Transaction[];
	totalSpent: number;
}

/* ── Delte typer: tema-lister (TripListsPanel) ───────── */

export interface ThemeListItem {
	id: string;
	text: string;
	checked: boolean;
	notes?: string | null;
	itemDate?: string | null;
	sortOrder: number;
}

export interface ThemeList {
	id: string;
	title: string;
	emoji: string;
	listType: string;
	sortOrder: number;
	items: ThemeListItem[];
}

export interface NewListInput {
	title: string;
	emoji: string;
	listType: string;
}

export interface NewListItemInput {
	text: string;
	itemDate: string | null;
}

/* ── Delte typer: sjekklister (TripDayCalendar) ──────── */

export interface ChecklistItem {
	id: string;
	text: string;
	checked: boolean;
	sortOrder: number;
	parentId?: string | null;
	skippedAt?: string | null;
	snoozedToDate?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ChecklistRow {
	id: string;
	context: string | null;
	items: ChecklistItem[];
}

export interface NewChecklistInput {
	title: string;
	emoji: string;
	context: string;
}

export interface CreatedChecklist {
	id: string;
	title: string;
	items: ChecklistItem[] | null;
}

/* ── Delte typer: helse (TripHealthStats) ────────────── */

export interface DailySteps {
	date: string;
	steps: number;
}

export interface DailySleep {
	date: string;
	hours: number;
}

export interface TrackPoint {
	lat: number;
	lon: number;
	ele?: number | null;
	hr?: number | null;
	time?: string | null;
}

export interface Workout {
	id: string;
	timestamp: string;
	date: string;
	sportType: string;
	distanceKm: number | null;
	durationMin: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	paceSecPerKm: number | null;
	elevationMeters: number | null;
	hasTrackPoints: boolean;
	trackEventId: string | null;
	sources: string[];
	evidence: number;
}

export interface HealthData {
	weight: {
		avgBefore7Days: number | null;
		avgAfter7Days: number | null;
		change: number | null;
		measurementsBefore: number;
		measurementsAfter: number;
	};
	steps: {
		avgPerDay: number | null;
		dailySteps: DailySteps[];
		daysWithData: number;
	};
	workouts: {
		count: number;
		list: Workout[];
	};
	sleep: {
		avgPerDay: number | null;
		dailySleep: DailySleep[];
		daysWithData: number;
	};
}

export interface HealthStatsEnvelope {
	success: boolean;
	data?: HealthData | null;
	error?: string;
}

/* ── Delte typer: diverse ────────────────────────────── */

export interface LiveSession {
	active: boolean;
	sessionId: string | null;
}

export interface PersonRow {
	id: string;
	name: string;
	kind: string;
	avatarEmoji?: string | null;
}

export interface DiaryWeather {
	emoji?: string;
	temp?: number;
	symbol?: string;
}

/** Lagret koordinat for et dagboknotat (geokodet sted, for kartfortellingen). */
export interface GeoCoord {
	lat: number;
	lon: number;
}

export interface DiaryEntry {
	date: string;
	content: string;
	place?: string;
	weather?: DiaryWeather;
	images?: string[];
	geo?: GeoCoord;
}

/** PUT på dagbok-endepunktet: kun {date} sletter notatet for dagen. */
export interface DiaryEntryInput {
	date: string;
	content?: string;
	place?: string;
	weather?: DiaryWeather;
	images?: string[];
	geo?: GeoCoord;
}

export interface PromoteTripInput {
	label: string;
	place?: string;
	startDate?: string;
	endDate?: string;
}

/* ── API-interface ───────────────────────────────────── */

export interface TripApi {
	/* Felles */
	/** Bankkontoer for utgiftsfiltrering (TripDashboard, TripBudget). Tom liste ved feil. */
	getAccounts(): Promise<BankAccount[]>;
	/** Geokoder et stedsnavn via Nominatim. null ved feil eller ingen treff. */
	geocode(query: string): Promise<GeoPoint | null>;
	/** Rå met.no-timeseries for et koordinat. null ved feil. */
	getMetForecast(lat: number, lon: number): Promise<MetTimeseriesEntry[] | null>;
	/** Observert vær for én dato via Open-Meteo (fallback når met.no-varsel er utløpt). null ved feil. */
	getHistoricalWeather(lat: number, lon: number, date: string): Promise<DiaryWeather | null>;

	/* TripDashboard */
	/** Aktiv live-sesjon for posisjonsdeling. null ved feil. */
	getLiveSession(): Promise<LiveSession | null>;
	/** Lagrer reiseprofilen. false ved feil. */
	saveTripProfile(themeId: string, profile: TripProfile): Promise<boolean>;

	/* TripBudget */
	/** Transaksjoner i periode og/eller via søk. null ved feil. */
	getTransactions(query: TransactionQuery): Promise<TransactionsResult | null>;

	/* TripListsPanel */
	/** Oppretter en tema-liste. null ved feil. */
	createList(themeId: string, input: NewListInput): Promise<ThemeList | null>;
	deleteList(themeId: string, listId: string): Promise<void>;
	/** Legger til et element i en liste. null ved feil. */
	createListItem(themeId: string, listId: string, input: NewListItemInput): Promise<ThemeListItem | null>;
	updateListItem(
		themeId: string,
		listId: string,
		itemId: string,
		patch: Partial<Pick<ThemeListItem, 'checked' | 'text' | 'notes' | 'itemDate'>>
	): Promise<void>;
	deleteListItem(themeId: string, listId: string, itemId: string): Promise<void>;

	/* TripDayCalendar */
	/** Henter sjekklister for gitte kontekster. null ved feil. */
	getChecklists(contexts: string[]): Promise<ChecklistRow[] | null>;
	/** Oppretter en dag-sjekkliste. null ved feil. */
	createChecklist(input: NewChecklistInput): Promise<CreatedChecklist | null>;
	/** Legger til sjekkliste-punkt(er). null ved feil. */
	addChecklistItems(
		checklistId: string,
		text: string,
		sortOrder: number,
		parentId?: string
	): Promise<ChecklistItem[] | null>;
	/** Oppdaterer et sjekkliste-punkt. false ved feil. */
	patchChecklistItem(
		checklistId: string,
		itemId: string,
		patch: Record<string, unknown>
	): Promise<boolean>;
	deleteChecklistItem(checklistId: string, itemId: string): Promise<boolean>;

	/* TripHealthStats */
	/** Helsestatistikk for turperioden. null ved HTTP-feil. */
	getHealthStats(themeId: string, startDate?: string, endDate?: string): Promise<HealthStatsEnvelope | null>;
	dismissWorkout(workoutId: string): Promise<void>;
	/** GPS-spor for en aktivitet. null ved feil. */
	getActivityTrack(trackEventId: string): Promise<TrackPoint[] | null>;

	/* FerieDashboard — spesialkall: komponenten leser status og feilmelding selv. */
	saveFerieProfile(
		themeId: string,
		payload: FerieProfilePayload,
		opts?: { keepalive?: boolean }
	): Promise<Response>;

	/* FerieGridView */
	/** Familiemedlemmer/personer. Tom liste ved feil. */
	getPersons(): Promise<PersonRow[]>;

	/* FerieExecutionView */
	/** Dagboknotater for ferien. null ved feil. */
	getDiary(themeId: string): Promise<DiaryEntry[] | null>;
	/** Lagrer (eller sletter, ved kun {date}) et dagboknotat. false ved feil. */
	putDiaryEntry(themeId: string, entry: DiaryEntryInput): Promise<boolean>;

	/* TripPlanningSection */
	/** Forfremmer en ferie-reise til eget reise-tema. null ved feil. */
	promoteTrip(themeId: string, input: PromoteTripInput): Promise<{ themeId: string } | null>;
}

/* ── Ekte implementasjon ─────────────────────────────── */

export const tripApi: TripApi = {
	async getAccounts() {
		const res = await fetch('/api/accounts');
		if (!res.ok) return [];
		const data = (await res.json()) as { accounts: BankAccount[] };
		return data.accounts || [];
	},

	async geocode(query) {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
				{ headers: { 'Accept-Language': 'nb,en' } }
			);
			const geo = (await res.json()) as Array<{ lat: string; lon: string }>;
			if (geo.length > 0) return { lat: parseFloat(geo[0].lat), lon: parseFloat(geo[0].lon) };
		} catch {
			/* best-effort */
		}
		return null;
	},

	async getMetForecast(lat, lon) {
		const ts = await fetchRawTimeseries(lat, lon);
		return ts as MetTimeseriesEntry[] | null;
	},

	async getHistoricalWeather(lat, lon, date) {
		const wx = await fetchOpenMeteoDay(lat, lon, date);
		return wx ? { emoji: wx.emoji, temp: wx.temp } : null;
	},

	async getLiveSession() {
		const res = await fetch('/api/apps/live-session');
		if (!res.ok) return null;
		return (await res.json()) as LiveSession;
	},

	async saveTripProfile(themeId, profile) {
		const res = await fetch(`/api/tema/${themeId}/trip`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(profile)
		});
		return res.ok;
	},

	async getTransactions(query) {
		const p = new URLSearchParams();
		if (query.from) p.set('from', query.from);
		if (query.to) p.set('to', query.to);
		if (query.search) p.set('search', query.search);
		if (query.accountIds && query.accountIds.length > 0) {
			p.set('accountIds', query.accountIds.join(','));
		}
		const res = await fetch(`/api/transactions?${p}`);
		if (!res.ok) return null;
		return (await res.json()) as TransactionsResult;
	},

	async createList(themeId, input) {
		const res = await fetch(`/api/tema/${themeId}/lists`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as ThemeList;
	},

	async deleteList(themeId, listId) {
		await fetch(`/api/tema/${themeId}/lists/${listId}`, { method: 'DELETE' });
	},

	async createListItem(themeId, listId, input) {
		const res = await fetch(`/api/tema/${themeId}/lists/${listId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as ThemeListItem;
	},

	async updateListItem(themeId, listId, itemId, patch) {
		await fetch(`/api/tema/${themeId}/lists/${listId}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
	},

	async deleteListItem(themeId, listId, itemId) {
		await fetch(`/api/tema/${themeId}/lists/${listId}/items/${itemId}`, { method: 'DELETE' });
	},

	async getChecklists(contexts) {
		const res = await fetch(`/api/checklists?contexts=${encodeURIComponent(contexts.join(','))}`);
		if (!res.ok) return null;
		return (await res.json()) as ChecklistRow[];
	},

	async createChecklist(input) {
		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as CreatedChecklist;
	},

	async addChecklistItems(checklistId, text, sortOrder, parentId) {
		const created = await addItems(checklistId, text, sortOrder, parentId);
		return created as ChecklistItem[] | null;
	},

	patchChecklistItem(checklistId, itemId, patch) {
		return patchItem(checklistId, itemId, patch);
	},

	deleteChecklistItem(checklistId, itemId) {
		return deleteItem(checklistId, itemId);
	},

	async getHealthStats(themeId, startDate, endDate) {
		const qs = startDate && endDate ? `?start=${startDate}&end=${endDate}` : '';
		const res = await fetch(`/api/tema/${themeId}/health-stats${qs}`);
		if (!res.ok) return null;
		return (await res.json()) as HealthStatsEnvelope;
	},

	async dismissWorkout(workoutId) {
		await fetch(`/api/workouts/${workoutId}/dismiss`, { method: 'POST' });
	},

	async getActivityTrack(trackEventId) {
		const res = await fetch(`/api/activities/${trackEventId}/track`);
		if (!res.ok) return null;
		const json = (await res.json()) as { trackPoints?: TrackPoint[] };
		return json.trackPoints ?? [];
	},

	saveFerieProfile(themeId, payload, opts) {
		return fetch(`/api/tema/${themeId}/ferie`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			keepalive: opts?.keepalive
		});
	},

	async getPersons() {
		const res = await fetch('/api/persons');
		if (!res.ok) return [];
		const data = (await res.json()) as { persons: PersonRow[] };
		return data.persons ?? [];
	},

	async getDiary(themeId) {
		const res = await fetch(`/api/tema/${themeId}/ferie/diary`);
		if (!res.ok) return null;
		const data = (await res.json()) as { entries: DiaryEntry[] };
		return data.entries ?? [];
	},

	async putDiaryEntry(themeId, entry) {
		const res = await fetch(`/api/tema/${themeId}/ferie/diary`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(entry)
		});
		return res.ok;
	},

	async promoteTrip(themeId, input) {
		const res = await fetch(`/api/tema/${themeId}/ferie/promote-trip`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) return null;
		return (await res.json()) as { themeId: string };
	}
};
