import type { ActionProducer } from '../action-suggestion-service';
import { localHm, hmToMinutes } from '$lib/server/nudge-time';

const SLOT_SWITCH_MIN = 14 * 60;

export const sjekkInnProducer: ActionProducer = (ctx) => {
	const ef = ctx.egenfrekvens;
	if (!ef) return [];
	if (ef.settings && ef.settings.enabled === false) return [];

	const hm = localHm(ctx.tz, ctx.now);
	const mins = hmToMinutes(hm);
	if (mins === null) return [];

	const slot: 'morning' | 'evening' = mins < SLOT_SWITCH_MIN ? 'morning' : 'evening';
	const entry = slot === 'morning' ? ef.today.morning : ef.today.evening;
	if (entry !== null) return [];

	return [
		{
			id: 'egenfrekvens-quick',
			icon: '✨',
			label: `Sjekk inn · ${slot === 'morning' ? 'morgen' : 'kveld'}`,
			priority: 100,
			source: 'system',
			intent: { kind: 'open-egenfrekvens', slot }
		}
	];
};
