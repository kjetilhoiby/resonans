import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts } from '$lib/server/local-time';
import { countInboxItems } from '$lib/server/inbox';

const WAKING_START_MIN = 7 * 60;
const WAKING_END_MIN = 23 * 60;
const MIN_ITEMS_TO_SHOW = 2;

export const sortInboxProducer: ActionProducer = async (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < WAKING_START_MIN || parts.minutesOfDay >= WAKING_END_MIN) return [];

	const count = await countInboxItems(ctx.userId);
	if (count < MIN_ITEMS_TO_SHOW) return [];

	return [
		{
			id: 'sort-inbox',
			icon: '🗂',
			label: `Sorter usortert (${count})`,
			priority: 58,
			source: 'system',
			intent: { kind: 'navigate', href: '/innboks' }
		}
	];
};
