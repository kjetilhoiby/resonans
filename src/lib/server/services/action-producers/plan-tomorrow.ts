import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts, isoWeekKey, isoDateKey, addDays } from '$lib/server/local-time';

const HOUR_THRESHOLD_MIN = 17 * 60;

export const planTomorrowProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < HOUR_THRESHOLD_MIN) return [];

	const t = addDays(parts.year, parts.month, parts.day, 1);
	const tomorrowIso = isoDateKey(t.year, t.month, t.day);
	const tomorrowWeek = isoWeekKey(t.year, t.month, t.day);
	const targetCtx = `week:${tomorrowWeek}:day:${tomorrowIso}`;

	if (ctx.plan.anyPlannedContexts.has(targetCtx)) return [];

	return [
		{
			id: 'plan-tomorrow',
			icon: '📋',
			label: 'Planlegg i morgen',
			priority: 80,
			source: 'system',
			intent: { kind: 'open-day-plan', iso: tomorrowIso, weekKey: tomorrowWeek }
		}
	];
};
