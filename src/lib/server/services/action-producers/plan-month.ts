import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts, yearMonthKey, daysInMonth, nextMonth } from '$lib/server/local-time';

export const planMonthProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	const total = daysInMonth(parts.year, parts.month);

	// Vises siste 5 dager i måneden
	if (parts.day < total - 4) return [];

	const nm = nextMonth(parts.year, parts.month);
	const nextMonthKey = yearMonthKey(nm.year, nm.month);
	const targetCtx = `month:${nextMonthKey}`;

	if (ctx.plan.activePlannedContexts.has(targetCtx)) return [];

	return [
		{
			id: 'plan-next-month',
			icon: '🗓️',
			label: 'Planlegg neste måned',
			priority: 60,
			source: 'system',
			intent: { kind: 'open-month-plan', monthKey: nextMonthKey }
		}
	];
};
