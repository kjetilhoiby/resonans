import { openai } from '$lib/server/openai';

type GoalFallbackResult = {
	matched: boolean;
	reason?: string;
	intent?: {
		signalType: 'activity_run_pr_week' | 'tracking_series_activity_pr_week';
		threshold: number;
		comparator: '>=';
		period: 'week';
		activityType: string;
		sourceText: string;
	};
	parser?: 'llm';
};

type TaskFallbackResult = {
	matched: boolean;
	reason?: string;
	intent?: {
		frequency: 'daily' | 'weekly' | 'monthly';
		targetValue: number;
		unit: string;
		period: 'day' | 'week' | 'month';
		comparator: '>=';
		sourceText: string;
	};
	parser?: 'llm';
};

function toPositiveInt(value: unknown): number | null {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	const rounded = Math.round(n);
	if (rounded < 1) return null;
	return rounded;
}

function normalizeActivityType(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value
		.toLowerCase()
		.replace(/[\u00e6]/g, 'ae')
		.replace(/[\u00f8]/g, 'o')
		.replace(/[\u00e5]/g, 'aa')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return normalized || null;
}

function normalizeGoalFromRaw(raw: unknown, sourceText: string): GoalFallbackResult {
	const input = (raw ?? {}) as Record<string, unknown>;
	const matched = input.matched === true;
	if (!matched) {
		const reason = typeof input.reason === 'string' ? input.reason : 'llm_no_match';
		return { matched: false, reason, parser: 'llm' };
	}

	const threshold = toPositiveInt(input.threshold);
	if (!threshold) {
		return { matched: false, reason: 'invalid_threshold', parser: 'llm' };
	}

	const signalType = input.signalType === 'activity_run_pr_week'
		? 'activity_run_pr_week'
		: 'tracking_series_activity_pr_week';

	const activityType = signalType === 'activity_run_pr_week'
		? 'running'
		: (normalizeActivityType(input.activityType) ?? null);

	if (!activityType) {
		return { matched: false, reason: 'unsupported_activity', parser: 'llm' };
	}

	return {
		matched: true,
		parser: 'llm',
		intent: {
			signalType,
			threshold,
			comparator: '>=',
			period: 'week',
			activityType,
			sourceText
		}
	};
}

function normalizeTaskFromRaw(raw: unknown, sourceText: string): TaskFallbackResult {
	const input = (raw ?? {}) as Record<string, unknown>;
	const matched = input.matched === true;
	if (!matched) {
		const reason = typeof input.reason === 'string' ? input.reason : 'llm_no_match';
		return { matched: false, reason, parser: 'llm' };
	}

	const periodValue = String(input.period ?? '').toLowerCase();
	let frequency: 'daily' | 'weekly' | 'monthly' | null = null;
	let period: 'day' | 'week' | 'month' | null = null;

	if (periodValue === 'day' || periodValue === 'daily') {
		frequency = 'daily';
		period = 'day';
	}
	if (periodValue === 'week' || periodValue === 'weekly') {
		frequency = 'weekly';
		period = 'week';
	}
	if (periodValue === 'month' || periodValue === 'monthly') {
		frequency = 'monthly';
		period = 'month';
	}

	if (!frequency || !period) {
		return { matched: false, reason: 'unsupported_period_or_threshold', parser: 'llm' };
	}

	const targetValue = toPositiveInt(input.targetValue ?? input.threshold);
	if (!targetValue) {
		return { matched: false, reason: 'invalid_threshold', parser: 'llm' };
	}

	return {
		matched: true,
		parser: 'llm',
		intent: {
			frequency,
			targetValue,
			unit: 'ganger',
			period,
			comparator: '>=',
			sourceText
		}
	};
}

export async function parseGoalIntentWithLlmFallback(rawText: string): Promise<GoalFallbackResult> {
	const text = rawText.trim();
	if (!text) return { matched: false, reason: 'empty_text' };

	const prompt = `Du parser norske målsetninger til en strukturert ukentlig aktivitets-intent.

Tekst:
"${text}"

Regler:
- matched=true kun hvis teksten beskriver en konkret aktivitet med frekvens per uke.
- running/loping/run skal mappe til signalType "activity_run_pr_week" og activityType "running".
- Andre aktiviteter skal mappe til signalType "tracking_series_activity_pr_week" og activityType i snake_case.
- threshold skal være heltall >= 1.
- period er alltid "week".

Returner kun JSON:
{
  "matched": true|false,
  "signalType": "activity_run_pr_week" | "tracking_series_activity_pr_week",
  "threshold": number,
  "period": "week",
  "activityType": "running|snake_case",
  "reason": "kort_kode_ved_ikke_match"
}`;

	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: 'Du er en deterministisk parser. Returner alltid valid JSON og ingen markdown.'
				},
				{ role: 'user', content: prompt }
			]
		});

		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content);
		return normalizeGoalFromRaw(parsed, text);
	} catch {
		return { matched: false, reason: 'llm_parse_failed' };
	}
}

export async function parseTaskIntentWithLlmFallback(rawText: string): Promise<TaskFallbackResult> {
	const text = rawText.trim();
	if (!text) return { matched: false, reason: 'empty_text' };

	const prompt = `Du parser norske oppgavetekster til strukturert frekvens.

Tekst:
"${text}"

Regler:
- matched=true hvis teksten beskriver et kvantifiserbart repetisjonsm\u00e5l.
- Hvis perioden ikke er nevnt eksplisitt, men teksten inneholder et tall + aktivitetsnavn (f.eks. "Fem joggeturer", "3 mikroyoga"), anta period=week.
- Tolk "hver dag"/"daglig" som period=day, targetValue=1.
- targetValue skal v\u00e6re heltall >= 1.
- period skal v\u00e6re en av: day, week, month.

Returner kun JSON:
{
  "matched": true|false,
  "targetValue": number,
  "period": "day" | "week" | "month",
  "reason": "kort_kode_ved_ikke_match"
}`;

	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: 'Du er en deterministisk parser. Returner alltid valid JSON og ingen markdown.'
				},
				{ role: 'user', content: prompt }
			]
		});

		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content);
		return normalizeTaskFromRaw(parsed, text);
	} catch {
		return { matched: false, reason: 'llm_parse_failed' };
	}
}