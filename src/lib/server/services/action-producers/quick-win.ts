import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts } from '$lib/server/local-time';

const WAKING_START_MIN = 8 * 60;
const WAKING_END_MIN = 22 * 60;

export const quickWinProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < WAKING_START_MIN || parts.minutesOfDay >= WAKING_END_MIN) return [];
	if (ctx.plan.openItemCount <= 0) return [];

	return [
		{
			id: 'quick-win',
			icon: '⚡',
			label: 'Quick win',
			priority: 65,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'quick_win' }
		}
	];
};
