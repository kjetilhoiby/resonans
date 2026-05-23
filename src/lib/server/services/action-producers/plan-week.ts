import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts, isoWeekKey, addDays } from '$lib/server/local-time';

export const planWeekProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);

	// Vises torsdag–søndag (dow 4–6 og 0)
	if (!(parts.dow >= 4 || parts.dow === 0)) return [];

	// Avstand til neste mandag: søndag = 1 dag, mandag = 7, … lørdag = 2
	const daysUntilMonday = parts.dow === 0 ? 1 : 8 - parts.dow;
	const mon = addDays(parts.year, parts.month, parts.day, daysUntilMonday);
	const nextWeek = isoWeekKey(mon.year, mon.month, mon.day);
	const targetCtx = `week:${nextWeek}`;

	if (ctx.plan.activePlannedContexts.has(targetCtx)) return [];

	return [
		{
			id: 'plan-next-week',
			icon: '📅',
			label: 'Planlegg neste uke',
			priority: 70,
			source: 'system',
			intent: { kind: 'open-week-plan' }
		}
	];
};
