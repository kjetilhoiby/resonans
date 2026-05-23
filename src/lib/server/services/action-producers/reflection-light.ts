import type { ActionProducer } from '../action-suggestion-service';
import { localDateParts } from '$lib/server/local-time';
import { getReflectionForPeriod } from '$lib/server/reflections';

const EVENING_START_MIN = 20 * 60;

export const reflectionLightProducer: ActionProducer = async (ctx) => {
	const parts = localDateParts(ctx.tz, ctx.now);
	if (parts.minutesOfDay < EVENING_START_MIN) return [];

	const existing = await getReflectionForPeriod(ctx.userId, 'reflection_light', parts.iso);
	if (existing) return [];

	return [
		{
			id: 'reflection-light',
			icon: '💭',
			label: 'Kort refleksjon',
			priority: 75,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'reflection_light' }
		}
	];
};
