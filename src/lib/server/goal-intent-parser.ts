import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';

type ParsedGoalIntent = {
	matched: boolean;
	reason?: string;
	intent?: {
		signalType: string;
		threshold: number;
		comparator: '>=';
		period: 'week';
		activityType: 'running';
		sourceText: string;
	};
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

export function parseGoalIntent(rawText: string): ParsedGoalIntent {
	const text = rawText.trim();
	if (!text) return { matched: false, reason: 'empty_text' };

	const lower = text.toLowerCase();
	const mentionsRunning = /\bl[øo]p(e|ing)?\b|\brun(ning)?\b/.test(lower);
	if (!mentionsRunning) {
		return { matched: false, reason: 'unsupported_activity' };
	}

	const countMatch = lower.match(/(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|ni|ti)\s+ganger\s+(i|per|pr\.?)\s+uk(e|a)/);
	if (!countMatch) {
		return { matched: false, reason: 'unsupported_period_or_threshold' };
	}

	const threshold = parseCountToken(countMatch[1]);
	if (!threshold || threshold < 1) {
		return { matched: false, reason: 'invalid_threshold' };
	}

	return {
		matched: true,
		intent: {
			signalType: 'activity_run_pr_week',
			threshold,
			comparator: '>=',
			period: 'week',
			activityType: 'running',
			sourceText: text
		}
	};
}

export async function processGoalIntentParseJob(params: {
	userId: string;
	goalId: string;
	rawText?: string;
}) {
	const goal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.goalId), eq(goals.userId, params.userId))
	});

	if (!goal) {
		throw new Error(`Goal not found for parsing: ${params.goalId}`);
	}

	const sourceText = params.rawText?.trim() || goal.title || '';
	const parsed = parseGoalIntent(sourceText);
	const existingMetadata = (goal.metadata ?? {}) as Record<string, unknown>;
	const nowIso = new Date().toISOString();

	const nextMetadata: Record<string, unknown> = {
		...existingMetadata,
		intentSourceText: sourceText,
		intentUpdatedAt: nowIso
	};

	if (parsed.matched && parsed.intent) {
		nextMetadata.intentStatus = 'parsed';
		nextMetadata.parsedIntent = parsed.intent;
		nextMetadata.intentError = null;
	} else {
		nextMetadata.intentStatus = 'failed';
		nextMetadata.parsedIntent = null;
		nextMetadata.intentError = parsed.reason ?? 'unknown';
	}

	await db
		.update(goals)
		.set({
			metadata: nextMetadata,
			updatedAt: new Date()
		})
		.where(eq(goals.id, goal.id));

	return {
		goalId: goal.id,
		matched: parsed.matched,
		reason: parsed.reason ?? null,
		parsedIntent: parsed.intent ?? null
	};
}
