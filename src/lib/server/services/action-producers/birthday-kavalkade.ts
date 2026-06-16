import type { ActionProducer } from '../action-suggestion-service';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { persons } from '$lib/db/schema';
import { localDateParts } from '$lib/server/local-time';
import { daysSinceLastBirthday, visKavalkadeChip } from '$lib/server/kavalkade';

/**
 * Årskavalkaden som hurtighandling fra bursdagen og dagene etter.
 *
 * «Selvangivelsen» nudger fram til midnatt før bursdagen og forsvinner på selve
 * dagen — denne tar over og inviterer inn i kavalkaden/showet, som er hele
 * poenget med dagen. På bursdagen går chipen rett til «spill av året»-showet.
 */
export const birthdayKavalkadeProducer: ActionProducer = async (ctx) => {
	const self = await db.query.persons.findFirst({
		where: and(
			eq(persons.userId, ctx.userId),
			eq(persons.kind, 'self'),
			eq(persons.archived, false)
		),
		columns: { birthDate: true }
	});
	if (!self?.birthDate) return [];

	// Kalenderdager i brukerens tidssone, ikke serverens
	const parts = localDateParts(ctx.tz, ctx.now);
	const today = new Date(parts.year, parts.month - 1, parts.day);
	const daysSince = daysSinceLastBirthday(self.birthDate, today);
	if (daysSince === null || !visKavalkadeChip(daysSince)) return [];

	const isBirthday = daysSince === 0;
	return [
		{
			id: 'birthday-kavalkade',
			icon: '🎉',
			label: isBirthday ? 'Gratulerer med dagen!' : 'Årskavalkaden',
			value: isBirthday ? 'spill av året' : 'året i tall',
			// På bursdagen helt øverst (over selvangivelsens 95); etterpå rolig
			priority: isBirthday ? 99 : 70,
			source: 'system',
			intent: { kind: 'navigate', href: isBirthday ? '/kavalkade/show' : '/kavalkade' }
		}
	];
};
