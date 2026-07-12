import type { ActionProducer } from '../action-suggestion-service';
import { and, eq, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { dreams } from '$lib/db/schema';
import { localDateParts } from '$lib/server/local-time';
import { getReflectionForPeriod } from '$lib/server/reflections';
import { isInQuarterWindow, quarterPeriodKey, daysIntoQuarter } from '$lib/flows/retning-kvartal';

const WINDOW_DAYS = 21;

/**
 * «Retningssamtalen» — kvartalsvis ærlighetssjekk som hurtighandling de
 * første ~3 ukene av hvert kvartal. Krever at en brukerforfattet retning
 * finnes (ellers er det livsintervjuet som gjelder), og forsvinner når
 * samtalen er gjennomført for kvartalet.
 */
export const retningKvartalProducer: ActionProducer = async (ctx) => {
	// Kalenderdager i brukerens tidssone, ikke serverens
	const parts = localDateParts(ctx.tz, ctx.now);
	const today = new Date(parts.year, parts.month - 1, parts.day);
	if (!isInQuarterWindow(today, WINDOW_DAYS)) return [];

	// Uten brukerforfattet retning er det ingenting å holde hverdagen opp mot
	const authored = await db.query.dreams.findFirst({
		where: and(
			eq(dreams.userId, ctx.userId),
			eq(dreams.originKind, 'user_authored'),
			like(dreams.kind, 'vision\\_%')
		),
		columns: { id: true }
	});
	if (!authored) return [];

	const periodKey = quarterPeriodKey(today);
	const [gap, samtale] = await Promise.all([
		getReflectionForPeriod(ctx.userId, 'retningsgap', periodKey),
		getReflectionForPeriod(ctx.userId, 'retningssamtale', periodKey)
	]);
	if (gap || samtale) return [];

	const windowEnd = new Date(today);
	windowEnd.setDate(windowEnd.getDate() + (WINDOW_DAYS - daysIntoQuarter(today) + 1));

	return [
		{
			id: 'retning-kvartal',
			icon: '🧭',
			label: 'Retningssamtalen',
			value: periodKey.split('-')[1],
			priority: 70,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'retning_kvartal' },
			expiresAt: windowEnd.toISOString()
		}
	];
};
