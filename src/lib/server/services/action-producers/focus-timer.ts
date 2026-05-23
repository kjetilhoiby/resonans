import type { ActionProducer } from '../action-suggestion-service';
import { localHm, hmToMinutes } from '$lib/server/nudge-time';

const START_MIN = 8 * 60;
const END_MIN = 17 * 60;

export const focusTimerProducer: ActionProducer = (ctx) => {
	const hm = localHm(ctx.tz, ctx.now);
	const mins = hmToMinutes(hm);
	if (mins === null || mins < START_MIN || mins >= END_MIN) return [];

	return [
		{
			id: 'focus-timer',
			icon: '🎯',
			label: 'Klar for en fokusøkt?',
			priority: 90,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'jobb_focus_timer' }
		}
	];
};
