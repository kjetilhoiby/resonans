// Ren validering av innkommende brukshendelser — ingen DB-kobling, testbar.

export type UsageEventType = 'page_view' | 'app_resume' | 'attention' | 'interaction';

export interface ParsedUsageEvent {
	eventType: UsageEventType;
	path: string | null;
	metadata: Record<string, unknown> | null;
	/** Klient-tidsstempel hvis gyldig og ferskt, ellers null (DB-default brukes) */
	createdAt: Date | null;
}

const VALID_TYPES = new Set<string>(['page_view', 'app_resume', 'attention', 'interaction']);
const MAX_BATCH = 100;
const MAX_ATTENTION_MS = 6 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

function parseClientTimestamp(value: unknown, now: Date): Date | null {
	if (typeof value !== 'string') return null;
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return null;
	const age = now.getTime() - at.getTime();
	// Batching forsinker innsending — godta ferske tidsstempler, avvis rariteter
	if (age < -MAX_CLOCK_SKEW_MS || age > MAX_EVENT_AGE_MS) return null;
	return at;
}

/** Godtar både én hendelse ({type, path}) og batch ({events: [...]}); ugyldige hendelser droppes */
export function parseUsagePayload(body: unknown, now: Date = new Date()): ParsedUsageEvent[] {
	const record = body as Record<string, unknown> | null;
	const raw: unknown[] = Array.isArray(record?.events) ? record.events : [body];
	const parsed: ParsedUsageEvent[] = [];

	for (const entry of raw.slice(0, MAX_BATCH)) {
		const item = entry as Record<string, unknown> | null;
		const type = typeof item?.type === 'string' && VALID_TYPES.has(item.type) ? (item.type as UsageEventType) : null;
		if (!item || !type) continue;

		const path = typeof item.path === 'string' ? item.path.slice(0, 500) : null;
		const rawMeta = (item.metadata ?? null) as Record<string, unknown> | null;
		let metadata: Record<string, unknown> | null = null;

		if (type === 'attention') {
			const durationMs = Number(rawMeta?.durationMs);
			if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
			metadata = { durationMs: Math.min(Math.round(durationMs), MAX_ATTENTION_MS) };
		} else if (type === 'interaction') {
			const label = typeof rawMeta?.label === 'string' ? rawMeta.label.slice(0, 120) : null;
			if (!label) continue;
			metadata = {
				label,
				...(typeof rawMeta?.tag === 'string' ? { tag: rawMeta.tag.slice(0, 20) } : {})
			};
		}

		parsed.push({
			eventType: type,
			path,
			metadata,
			createdAt: parseClientTimestamp(item.at, now)
		});
	}

	return parsed;
}
