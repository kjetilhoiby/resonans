import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, tasks } from '$lib/db/schema';
import { openai } from '$lib/server/openai';

export type ActivityType =
	| 'running'
	| 'cycling'
	| 'walking'
	| 'strength'
	| 'swimming'
	| 'yoga'
	| 'hiit'
	| 'rowing'
	| 'skiing'
	| 'other';

export type TaskIntent = {
	frequency: 'daily' | 'weekly' | 'monthly' | 'once';
	targetValue: number;
	unit: string;
	period: 'day' | 'week' | 'month';
	comparator: '>=';
	// Activity-based intent (optional)
	activityType?: ActivityType;
	durationMinutes?: number;
	distanceKm?: number;
	sourceText: string;
};

export type ParsedTaskIntent = {
	matched: boolean;
	reason?: string;
	intent?: TaskIntent;
};

const NUMBER_WORDS: Record<string, number> = {
	en: 1,
	ett: 1,
	to: 2,
	tre: 3,
	fire: 4,
	fem: 5,
	seks: 6,
	syv: 7,
	sju: 7,
	åtte: 8,
	atte: 8,
	ni: 9,
	ti: 10,
	elleve: 11,
	tolv: 12,
	tretten: 13,
	fjorten: 14,
	femten: 15,
	seksten: 16,
	sytten: 17,
	atten: 18,
	nitten: 19,
	tjue: 20,
	tredve: 30,
	tretti: 30,
	førti: 40,
	femti: 50,
	seksti: 60,
	sytti: 70,
	åtti: 80,
	nitti: 90
};

// Maps Norwegian activity keywords to canonical ActivityType
const ACTIVITY_KEYWORDS: Array<[RegExp, ActivityType]> = [
	[/\b(løp(e|er|ing)?|sprin(te?|ting)?|jogge?|jogging)\b/, 'running'],
	[/\b(sykl(e|er|ing)?|sykkel|bike|biking)\b/, 'cycling'],
	[/\b(gå(tur)?|turgå(er|ing)?|walking|walk)\b/, 'walking'],
	[/\b(styrke(trening)?|vektløft(ing)?|gym|trene?\s+styrke)\b/, 'strength'],
	[/\b(svøm(me|ming|mer)?|swim(ming)?)\b/, 'swimming'],
	[/\b(yoga)\b/, 'yoga'],
	[/\b(hiit|intervall(trening)?)\b/, 'hiit'],
	[/\b(ro(ing)?|roing|rowing)\b/, 'rowing'],
	[/\b(ski(løp(ing)?|ing)?|langrenn|alpint)\b/, 'skiing'],
];

function parseCountToken(token: string): number | null {
	const normalized = token.trim().toLowerCase();
	if (/^\d+$/.test(normalized)) {
		const n = Number(normalized);
		return Number.isFinite(n) ? n : null;
	}
	return NUMBER_WORDS[normalized] ?? null;
}

function parseActivityType(lower: string): ActivityType | undefined {
	for (const [pattern, type] of ACTIVITY_KEYWORDS) {
		if (pattern.test(lower)) return type;
	}
	return undefined;
}

/**
 * Parses a duration expression like "20 minutter", "tjue minutter", "en halvtime", "en time"
 * Returns minutes or null.
 */
function parseDurationMinutes(lower: string): number | null {
	// "X minutter"
	const minMatch = lower.match(/(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|åtte|ni|ti|elleve|tolv|tretten|fjorten|femten|seksten|sytten|atten|nitten|tjue|tredve|tretti|førti|femti|seksti|sytti|åtti|nitti)\s+min(utt(er)?)?/);
	if (minMatch) {
		const v = parseCountToken(minMatch[1]);
		if (v !== null) return v;
	}
	// "X timer" / "X time"
	const hourMatch = lower.match(/(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|åtte|ni|ti)\s+time(r)?/);
	if (hourMatch) {
		const v = parseCountToken(hourMatch[1]);
		if (v !== null) return v * 60;
	}
	// "en halvtime"
	if (/\b(en\s+)?halvtime\b/.test(lower)) return 30;
	// "en time og et kvarter"
	if (/\ben\s+time\s+og\s+et\s+kvarter\b/.test(lower)) return 75;
	// "et kvarter"
	if (/\bet\s+kvarter\b/.test(lower)) return 15;
	return null;
}

/**
 * Parses a distance expression like "5 km", "tre kilometer"
 */
function parseDistanceKm(lower: string): number | null {
	const kmMatch = lower.match(/(\d+(?:[.,]\d+)?|en|ett|to|tre|fire|fem|seks|syv|sju|ti)\s+k(ilo)?m(eter)?/);
	if (kmMatch) {
		const raw = kmMatch[1].replace(',', '.');
		const v = /^\d/.test(raw) ? parseFloat(raw) : parseCountToken(raw);
		if (v !== null && Number.isFinite(v)) return v;
	}
	return null;
}

export function parseTaskIntent(rawText: string): ParsedTaskIntent {
	const text = rawText.trim();
	if (!text) return { matched: false, reason: 'empty_text' };

	const lower = text.toLowerCase();

	// --- Detect activity type + optional duration/distance ---
	const activityType = parseActivityType(lower);
	const durationMinutes = parseDurationMinutes(lower) ?? undefined;
	const distanceKm = parseDistanceKm(lower) ?? undefined;

	// --- Frequency: "X ganger per dag/uke/måned" ---
	// Accepts: "3 ganger i uka", "3 ganger per uke", "3 ganger i uken", "3 ganger denne uken", "tre ganger i måneden"
	const countMatch = lower.match(/(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|åtte|ni|ti|elleve|tolv|tretten|fjorten|femten|seksten|sytten|atten|nitten|tjue|tredve|tretti|førti|femti|seksti)\s+ganger\s+(?:(?:i|per|pr\.?)\s+|denne\s+)(dag(?:en)?|uke(?:n|a)?|måned(?:en)?)/);

	if (countMatch) {
		const threshold = parseCountToken(countMatch[1]);
		if (!threshold || threshold < 1) return { matched: false, reason: 'invalid_threshold' };

		const periodRaw = countMatch[3];
		// Normalise variants: "uka"/"uken" → "uke", "dagen" → "dag", "måneden" → "måned"
		const periodToken = periodRaw.startsWith('uke') ? 'uke'
			: periodRaw.startsWith('dag') ? 'dag'
			: periodRaw.startsWith('måned') ? 'måned'
			: periodRaw;
		const periodMap: Record<string, { frequency: TaskIntent['frequency']; period: TaskIntent['period'] }> = {
			dag: { frequency: 'daily', period: 'day' },
			uke: { frequency: 'weekly', period: 'week' },
			måned: { frequency: 'monthly', period: 'month' }
		};
		const p = periodMap[periodToken];
		if (!p) return { matched: false, reason: 'unsupported_period_or_threshold' };

		const unit = activityType
			? (durationMinutes ? 'minutter' : distanceKm ? 'km' : 'ganger')
			: 'ganger';

		return {
			matched: true,
			intent: {
				frequency: p.frequency,
				targetValue: threshold,
				unit,
				period: p.period,
				comparator: '>=',
				...(activityType && { activityType }),
				...(durationMinutes && { durationMinutes }),
				...(distanceKm && { distanceKm }),
				sourceText: text
			}
		};
	}

	// --- "hver dag" / "daglig" (daily, once per day) ---
	if (/\bhver\s+dag\b/.test(lower) || /\bdaglig\b/.test(lower)) {
		return {
			matched: true,
			intent: {
				frequency: 'daily',
				targetValue: 1,
				unit: activityType ? (durationMinutes ? 'minutter' : 'ganger') : 'ganger',
				period: 'day',
				comparator: '>=',
				...(activityType && { activityType }),
				...(durationMinutes && { durationMinutes }),
				...(distanceKm && { distanceKm }),
				sourceText: text
			}
		};
	}

	// --- Activity + duration/distance only (e.g. "løpe 20 minutter") ---
	// This is a "single-occurrence" intent — useful for day-level items
	if (activityType && (durationMinutes !== undefined || distanceKm !== undefined)) {
		return {
			matched: true,
			intent: {
				frequency: 'once',
				targetValue: durationMinutes ?? (distanceKm ? distanceKm * 10 : 1),
				unit: durationMinutes ? 'minutter' : distanceKm ? 'km' : 'ganger',
				period: 'day',
				comparator: '>=',
				activityType,
				...(durationMinutes !== undefined && { durationMinutes }),
				...(distanceKm !== undefined && { distanceKm }),
				sourceText: text
			}
		};
	}

	return { matched: false, reason: 'unsupported_period_or_threshold' };
}

export async function processTaskIntentParseJob(params: {
	userId: string;
	taskId: string;
	rawText?: string;
}) {
	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, params.taskId)
	});

	if (!task) {
		throw new Error(`Task not found for parsing: ${params.taskId}`);
	}

	const ownerGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, task.goalId), eq(goals.userId, params.userId)),
		columns: { id: true }
	});

	if (!ownerGoal) {
		throw new Error(`Task not found for user parsing: ${params.taskId}`);
	}

	const sourceText = params.rawText?.trim() || task.title || '';

	// Try LLM first, fall back to regex
	let parsed: ReturnType<typeof parseTaskIntent>;
	try {
		parsed = await parseTaskIntentWithLLM(sourceText);
	} catch (err) {
		console.warn('[task-intent-parser] LLM parse failed, falling back to regex:', err);
		parsed = parseTaskIntent(sourceText);
	}

	const currentMetadata = (task.metadata ?? {}) as Record<string, unknown>;

	if (parsed.matched && parsed.intent) {
		await db
			.update(tasks)
			.set({
				frequency: parsed.intent.frequency,
				targetValue: parsed.intent.targetValue,
				unit: parsed.intent.unit,
				metadata: {
					...currentMetadata,
					intentStatus: 'parsed',
					intentError: null,
					parsedIntent: {
						activityType: parsed.intent.activityType ?? null,
						durationMinutes: parsed.intent.durationMinutes ?? null,
						distanceKm: parsed.intent.distanceKm ?? null,
						frequency: parsed.intent.frequency,
						targetValue: parsed.intent.targetValue,
						unit: parsed.intent.unit,
						period: parsed.intent.period,
						comparator: parsed.intent.comparator,
						sourceText
					}
				},
				updatedAt: new Date()
			})
			.where(and(eq(tasks.id, task.id), eq(tasks.goalId, task.goalId)));
	} else {
		await db
			.update(tasks)
			.set({
				metadata: {
					...currentMetadata,
					intentStatus: 'failed',
					intentError: parsed.reason ?? 'unknown'
				},
				updatedAt: new Date()
			})
			.where(and(eq(tasks.id, task.id), eq(tasks.goalId, task.goalId)));
	}

	return {
		taskId: task.id,
		matched: parsed.matched,
		reason: parsed.reason ?? null,
		parsedIntent: parsed.intent ?? null,
		applied: Boolean(parsed.matched && parsed.intent)
	};
}

/**
 * Use GPT-4o-mini to parse task intent from free-form Norwegian text.
 * Returns the same shape as `parseTaskIntent`.
 */
async function parseTaskIntentWithLLM(text: string): Promise<ReturnType<typeof parseTaskIntent>> {
	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		temperature: 0,
		response_format: { type: 'json_object' },
		messages: [
			{
				role: 'system',
				content: `Du er en strukturert dataparser. Gitt en norsk oppgavetekst, trekk ut strukturert intent.

Returner alltid gyldig JSON med disse feltene:
- matched: boolean — true hvis du kan trekke ut minst frequency + targetValue
- frequency: "daily" | "weekly" | "monthly" | "once" | null
- targetValue: number | null — antall repetisjoner, minutter, km, etc.
- unit: string | null — f.eks. "ganger", "minutter", "km"
- period: "day" | "week" | "month" | null
- comparator: ">=" | null
- activityType: "running"|"cycling"|"walking"|"strength"|"swimming"|"yoga"|"hiit"|"rowing"|"skiing"|"other" | null
- durationMinutes: number | null
- distanceKm: number | null
- reason: string | null — kort forklaring hvis matched=false

Eksempler:
"Løpe 3 ganger denne uken" → {matched:true, frequency:"weekly", targetValue:3, unit:"ganger", period:"week", comparator:">=", activityType:"running", durationMinutes:null, distanceKm:null, reason:null}
"Mikroyoga fem ganger i uka" → {matched:true, frequency:"weekly", targetValue:5, unit:"ganger", period:"week", comparator:">=", activityType:"yoga", durationMinutes:null, distanceKm:null, reason:null}
"Løpe 150 km" → {matched:true, frequency:"once", targetValue:150, unit:"km", period:null, comparator:">=", activityType:"running", durationMinutes:null, distanceKm:150, reason:null}
"Sykkel 45 minutter" → {matched:true, frequency:"once", targetValue:45, unit:"minutter", period:"day", comparator:">=", activityType:"cycling", durationMinutes:45, distanceKm:null, reason:null}
"Les bok" → {matched:false, frequency:null, targetValue:null, unit:null, period:null, comparator:null, activityType:null, durationMinutes:null, distanceKm:null, reason:"no_quantifiable_target"}`
			},
			{
				role: 'user',
				content: text
			}
		]
	});

	const raw = response.choices[0]?.message?.content ?? '{}';
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(raw);
	} catch {
		return { matched: false, reason: 'llm_invalid_json' };
	}

	const matched = data.matched === true;
	if (!matched) {
		return { matched: false, reason: typeof data.reason === 'string' ? data.reason : 'llm_no_match' };
	}

	const frequency = typeof data.frequency === 'string' ? data.frequency as TaskIntent['frequency'] : 'once';
	const targetValue = typeof data.targetValue === 'number' ? data.targetValue : 1;
	const unit = typeof data.unit === 'string' ? data.unit : 'ganger';
	const period = typeof data.period === 'string' ? data.period as TaskIntent['period'] : 'week';
	const activityType = typeof data.activityType === 'string' && data.activityType !== 'null'
		? data.activityType as ActivityType
		: undefined;
	const durationMinutes = typeof data.durationMinutes === 'number' ? data.durationMinutes : undefined;
	const distanceKm = typeof data.distanceKm === 'number' ? data.distanceKm : undefined;

	return {
		matched: true,
		intent: {
			frequency,
			targetValue,
			unit,
			period,
			comparator: '>=',
			...(activityType && { activityType }),
			...(durationMinutes !== undefined && { durationMinutes }),
			...(distanceKm !== undefined && { distanceKm }),
			sourceText: text
		}
	};
}
