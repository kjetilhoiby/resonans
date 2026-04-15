import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, tasks } from '$lib/db/schema';

type TaskIntent = {
	frequency: 'daily' | 'weekly' | 'monthly';
	targetValue: number;
	unit: string;
	period: 'day' | 'week' | 'month';
	comparator: '>=';
	sourceText: string;
};

type ParsedTaskIntent = {
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
	atte: 8,
	ni: 9,
	ti: 10
};

function parseCountToken(token: string): number | null {
	const normalized = token.trim().toLowerCase();
	if (/^\d+$/.test(normalized)) {
		const n = Number(normalized);
		return Number.isFinite(n) ? n : null;
	}
	return NUMBER_WORDS[normalized] ?? null;
}

export function parseTaskIntent(rawText: string): ParsedTaskIntent {
	const text = rawText.trim();
	if (!text) return { matched: false, reason: 'empty_text' };

	const lower = text.toLowerCase();
	const countMatch = lower.match(/(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|ni|ti)\s+ganger\s+(i|per|pr\.?)\s+(dag|uke|måned)/);
	if (!countMatch) {
		if (/\bhver\s+dag\b/.test(lower) || /\bdaglig\b/.test(lower)) {
			return {
				matched: true,
				intent: {
					frequency: 'daily',
					targetValue: 1,
					unit: 'ganger',
					period: 'day',
					comparator: '>=',
					sourceText: text
				}
			};
		}
		return { matched: false, reason: 'unsupported_period_or_threshold' };
	}

	const threshold = parseCountToken(countMatch[1]);
	if (!threshold || threshold < 1) {
		return { matched: false, reason: 'invalid_threshold' };
	}

	const periodToken = countMatch[3];
	if (periodToken === 'dag') {
		return {
			matched: true,
			intent: {
				frequency: 'daily',
				targetValue: threshold,
				unit: 'ganger',
				period: 'day',
				comparator: '>=',
				sourceText: text
			}
		};
	}

	if (periodToken === 'uke') {
		return {
			matched: true,
			intent: {
				frequency: 'weekly',
				targetValue: threshold,
				unit: 'ganger',
				period: 'week',
				comparator: '>=',
				sourceText: text
			}
		};
	}

	if (periodToken === 'måned') {
		return {
			matched: true,
			intent: {
				frequency: 'monthly',
				targetValue: threshold,
				unit: 'ganger',
				period: 'month',
				comparator: '>=',
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
	const parsed = parseTaskIntent(sourceText);

	if (parsed.matched && parsed.intent) {
		await db
			.update(tasks)
			.set({
				frequency: parsed.intent.frequency,
				targetValue: parsed.intent.targetValue,
				unit: parsed.intent.unit,
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
