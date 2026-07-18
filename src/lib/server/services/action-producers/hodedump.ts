import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts } from '$lib/server/local-time';

const WAKING_START_MIN = 7 * 60;
const WAKING_END_MIN = 23 * 60;

/** «Tøm hodet» — hodedump-øvelsen. Tilgjengelig i våken tid, som Noter. */
export const hodedumpProducer: ActionProducer = (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < WAKING_START_MIN || parts.minutesOfDay >= WAKING_END_MIN) return [];

	return [
		{
			id: 'hodedump',
			icon: '🧺',
			label: 'Tøm hodet',
			priority: 45,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'hodedump' }
		}
	];
};
