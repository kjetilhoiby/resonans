// Ren oppsummeringslogikk for brukslogging — ingen DB-kobling, testbar.

export type UsageEventType = 'page_view' | 'app_resume' | 'attention' | 'interaction';

export interface UsageEventRow {
	eventType: string;
	path: string | null;
	metadata?: Record<string, unknown> | null;
	createdAt: Date;
}

export interface PathSummary {
	path: string;
	views: number;
	attentionMs: number;
	lastSeen: string; // ISO-timestamp
}

export interface DaySummary {
	events: number;
	attentionMs: number;
}

export interface InteractionSummary {
	label: string;
	count: number;
}

export interface UsageSummary {
	totalEvents: number;
	activeDays: number;
	/** Estimerte økter: hendelser med mer enn 30 min mellomrom regnes som ny økt */
	sessions: number;
	totalAttentionMs: number;
	byDay: Record<string, DaySummary>;
	byPath: PathSummary[];
	/** Fordeling på time i døgnet, Oslo-tid */
	byHour: Record<number, number>;
	topInteractions: InteractionSummary[];
}

const SESSION_GAP_MS = 30 * 60 * 1000;
const TOP_INTERACTIONS_LIMIT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-zA-Z_-]{16,}$/;
const NUMERIC_RE = /^\d+$/;

/** Normaliserer dynamiske segmenter ('/tema/3f2a…' → '/tema/[id]') så like sider telles sammen */
export function normalizePath(path: string): string {
	const clean = path.split('?')[0].split('#')[0];
	const segments = clean.split('/').map((segment) => {
		if (UUID_RE.test(segment) || TOKEN_RE.test(segment) || NUMERIC_RE.test(segment)) {
			return '[id]';
		}
		return segment;
	});
	const normalized = segments.join('/');
	return normalized === '' ? '/' : normalized;
}

function toOsloIsoDay(date: Date): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(date);
}

function toOsloHour(date: Date): number {
	const hour = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Oslo',
		hour: '2-digit',
		hour12: false
	}).format(date);
	return Number(hour) % 24;
}

export function countSessions(timestamps: Date[]): number {
	if (timestamps.length === 0) return 0;
	const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
	let sessions = 1;
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].getTime() - sorted[i - 1].getTime() > SESSION_GAP_MS) sessions++;
	}
	return sessions;
}

export function summarizeUsage(events: UsageEventRow[]): UsageSummary {
	const byDay: Record<string, DaySummary> = {};
	const byHour: Record<number, number> = {};
	const pathMap = new Map<string, { views: number; attentionMs: number; lastSeen: Date }>();
	const interactionCounts = new Map<string, number>();
	let totalAttentionMs = 0;

	for (const event of events) {
		const day = toOsloIsoDay(event.createdAt);
		const daySummary = (byDay[day] ??= { events: 0, attentionMs: 0 });
		daySummary.events++;

		const hour = toOsloHour(event.createdAt);
		byHour[hour] = (byHour[hour] ?? 0) + 1;

		const isPageView = event.eventType === 'page_view';
		const attentionMs = event.eventType === 'attention' ? Number(event.metadata?.durationMs) || 0 : 0;

		if ((isPageView || attentionMs > 0) && event.path) {
			const path = normalizePath(event.path);
			const entry = pathMap.get(path) ?? { views: 0, attentionMs: 0, lastSeen: event.createdAt };
			if (isPageView) entry.views++;
			entry.attentionMs += attentionMs;
			if (event.createdAt > entry.lastSeen) entry.lastSeen = event.createdAt;
			pathMap.set(path, entry);
		}

		if (attentionMs > 0) {
			totalAttentionMs += attentionMs;
			daySummary.attentionMs += attentionMs;
		}

		if (event.eventType === 'interaction') {
			const label = typeof event.metadata?.label === 'string' ? event.metadata.label : null;
			if (label) interactionCounts.set(label, (interactionCounts.get(label) ?? 0) + 1);
		}
	}

	const byPath: PathSummary[] = [...pathMap.entries()]
		.map(([path, { views, attentionMs, lastSeen }]) => ({
			path,
			views,
			attentionMs,
			lastSeen: lastSeen.toISOString()
		}))
		.sort((a, b) => b.attentionMs - a.attentionMs || b.views - a.views);

	const topInteractions: InteractionSummary[] = [...interactionCounts.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, TOP_INTERACTIONS_LIMIT);

	return {
		totalEvents: events.length,
		activeDays: Object.keys(byDay).length,
		sessions: countSessions(events.map((e) => e.createdAt)),
		totalAttentionMs,
		byDay,
		byPath,
		byHour,
		topInteractions
	};
}
