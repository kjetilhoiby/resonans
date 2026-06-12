import type { ActionProducer } from '../action-suggestion-service';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { persons } from '$lib/db/schema';
import { localDateParts } from '$lib/server/local-time';
import { getReflectionForPeriod } from '$lib/server/reflections';
import { getBirthdayWindows, selvangivelseFristLabel } from '$lib/server/kavalkade';

/**
 * «Selvangivelsen» — bursdagsintervjuet som hurtighandling i dagene før
 * bursdagen. Frist: midnatt kvelden før. Forsvinner når intervjuet er
 * levert for året, og på selve bursdagen (da er det kavalkaden som gjelder).
 */
export const birthdayInterviewProducer: ActionProducer = async (ctx) => {
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
	const { nextBirthday } = getBirthdayWindows(self.birthDate, today);
	if (!nextBirthday) return [];
	const daysUntil = Math.round((nextBirthday.getTime() - today.getTime()) / 86_400_000);

	const frist = selvangivelseFristLabel(daysUntil);
	if (!frist) return [];

	const delivered = await getReflectionForPeriod(
		ctx.userId,
		'birthday_interview',
		String(nextBirthday.getFullYear())
	);
	if (delivered) return [];

	return [
		{
			id: 'birthday-interview',
			icon: '🎂',
			label: 'Selvangivelsen',
			value: frist,
			// Over plan-/refleksjonschips, og aller øverst på frist-dagen
			priority: daysUntil === 1 ? 95 : 85,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'birthday_interview' },
			expiresAt: nextBirthday.toISOString()
		}
	];
};
