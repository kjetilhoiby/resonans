import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts } from '$lib/server/local-time';

const WAKING_START_MIN = 7 * 60;
const WAKING_END_MIN = 23 * 60;

export const inboxNoteProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < WAKING_START_MIN || parts.minutesOfDay >= WAKING_END_MIN) return [];

	return [
		{
			id: 'inbox-note',
			icon: '📥',
			label: 'Noter',
			priority: 55,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'inbox_note' }
		}
	];
};
