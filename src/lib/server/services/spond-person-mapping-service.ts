import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PersonService } from './person-service';

/**
 * Etter Spond-sync, gå gjennom alle spond_event-rader uten personId og prøv
 * å matche `data.groupId` mot `persons.spondGroupIds`. Setter personId der det matcher.
 */
export class SpondPersonMappingService {
	static async tagUserSpondEvents(userId: string): Promise<{ tagged: number }> {
		const persons = await PersonService.listForUser(userId);
		const groupToPerson = new Map<string, string>();
		for (const p of persons) {
			for (const groupId of p.spondGroupIds) {
				if (groupId && !groupToPerson.has(groupId)) {
					groupToPerson.set(groupId, p.id);
				}
			}
		}
		if (groupToPerson.size === 0) return { tagged: 0 };

		// Hent untagged spond_event for brukeren
		const untagged = await db
			.select({
				id: sensorEvents.id,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'spond_event'),
					isNull(sensorEvents.personId)
				)
			);

		let tagged = 0;
		for (const row of untagged) {
			const groupId = (row.data as { groupId?: string | null } | null)?.groupId;
			if (!groupId) continue;
			const personId = groupToPerson.get(groupId);
			if (!personId) continue;
			await db
				.update(sensorEvents)
				.set({ personId })
				.where(eq(sensorEvents.id, row.id));
			tagged += 1;
		}

		return { tagged };
	}

	/**
	 * Gjør motsatt: hvis bruker registrerer en ny Spond-gruppe på en person, kjør på nytt for å bakfylle eksisterende events.
	 */
	static async tagEventsForPerson(userId: string, personId: string): Promise<{ tagged: number }> {
		const person = await PersonService.getById(personId, userId);
		if (!person || person.spondGroupIds.length === 0) return { tagged: 0 };

		let tagged = 0;
		for (const groupId of person.spondGroupIds) {
			const result = await db.execute(sql`
				UPDATE sensor_events
				SET person_id = ${personId}
				WHERE user_id = ${userId}
				  AND data_type = 'spond_event'
				  AND person_id IS NULL
				  AND data->>'groupId' = ${groupId}
			`);
			tagged += (result as unknown as { rowCount?: number }).rowCount ?? 0;
		}
		return { tagged };
	}
}
