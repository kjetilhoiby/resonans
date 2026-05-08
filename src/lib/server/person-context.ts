import { db } from '$lib/db';
import { persons, memories, goals, sensorEvents, messagePersonMentions, messages } from '$lib/db/schema';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';

/**
 * Bygger en kontekst-streng om en bestemt person, til bruk i system-prompt
 * for person-scopede samtaler (`conversations.personId IS NOT NULL`).
 *
 * Returnerer tom streng hvis personen ikke finnes.
 */
export async function buildPersonContext(userId: string, personId: string): Promise<string> {
	const [person] = await db
		.select()
		.from(persons)
		.where(and(eq(persons.id, personId), eq(persons.userId, userId)))
		.limit(1);
	if (!person) return '';

	const memoryHorizon = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
	const [recentMemories, openGoals, upcomingEvents, recentMentions] = await Promise.all([
		db
			.select()
			.from(memories)
			.where(
				and(
					eq(memories.userId, userId),
					eq(memories.personId, personId),
					gte(memories.createdAt, memoryHorizon)
				)
			)
			.orderBy(desc(memories.importance), desc(memories.createdAt))
			.limit(15),
		db
			.select()
			.from(goals)
			.where(
				and(
					eq(goals.userId, userId),
					eq(goals.personId, personId),
					eq(goals.status, 'active')
				)
			)
			.orderBy(desc(goals.createdAt))
			.limit(10),
		db
			.select()
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.personId, personId),
					eq(sensorEvents.dataType, 'spond_event'),
					gte(sensorEvents.timestamp, new Date())
				)
			)
			.orderBy(sensorEvents.timestamp)
			.limit(5),
		db
			.select({
				createdAt: messages.createdAt,
				role: messages.role,
				content: messages.content,
				confidence: messagePersonMentions.confidence
			})
			.from(messagePersonMentions)
			.innerJoin(messages, eq(messagePersonMentions.messageId, messages.id))
			.where(
				and(
					eq(messagePersonMentions.userId, userId),
					eq(messagePersonMentions.personId, personId),
					isNotNull(messages.content)
				)
			)
			.orderBy(desc(messages.createdAt))
			.limit(5)
	]);

	const age = computeAge(person.birthDate);
	const lines: string[] = [];
	lines.push('\n--- PERSONKONTEKST ---');
	lines.push(`Denne samtalen er scoped til en bestemt person:`);
	lines.push(`• Navn: ${person.name}${person.nickname ? ` ("${person.nickname}")` : ''}`);
	lines.push(`• Type: ${person.kind}`);
	if (age !== null) lines.push(`• Alder: ${age} år`);
	if (person.notes) lines.push(`• Notater: ${person.notes}`);

	if (recentMemories.length > 0) {
		lines.push('\nMEMORIES OM ${name} (siste 6 mnd, viktigste først):'.replace('${name}', person.name));
		for (const m of recentMemories) {
			const importance = m.importance === 'high' ? '⭐' : m.importance === 'medium' ? '•' : '-';
			lines.push(`${importance} [${m.category}] ${m.content}`);
		}
	}

	if (openGoals.length > 0) {
		lines.push('\nÅPNE MÅL KNYTTET TIL DENNE PERSONEN:');
		for (const g of openGoals) {
			lines.push(`• ${g.title}${g.description ? ` — ${g.description}` : ''}`);
		}
	}

	if (upcomingEvents.length > 0) {
		lines.push('\nKOMMENDE EVENTS (Spond):');
		for (const e of upcomingEvents) {
			const data = (e.data as { name?: string; startTimestamp?: string; groupName?: string } | null) ?? {};
			const when = data.startTimestamp ? new Date(data.startTimestamp).toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
			lines.push(`• ${when} — ${data.name ?? 'Aktivitet'}${data.groupName ? ` (${data.groupName})` : ''}`);
		}
	}

	if (recentMentions.length > 0) {
		lines.push('\nSISTE OMTALER AV PERSONEN I CHATTER (nyligste først):');
		for (const m of recentMentions) {
			const who = m.role === 'user' ? 'Du' : 'Resonans';
			const date = m.createdAt.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
			const snippet = m.content.length > 200 ? m.content.slice(0, 197) + '…' : m.content;
			const tag = m.confidence === 'explicit' ? '@' : '';
			lines.push(`- ${date} (${who}, ${tag}${m.confidence}): ${snippet}`);
		}
	}

	lines.push('\nVÆR EMPATISK OG KONKRET. Bruk personkontekst aktivt: vis at du husker hva som er sagt før, og knytt råd til relasjonen. Lagre nye observasjoner som memory med personId og kategori "relationship".');
	lines.push('--- SLUTT PÅ PERSONKONTEKST ---\n');

	return lines.join('\n');
}

function computeAge(birthDate: string | null): number | null {
	if (!birthDate) return null;
	const d = new Date(birthDate);
	if (Number.isNaN(d.getTime())) return null;
	const today = new Date();
	let age = today.getFullYear() - d.getFullYear();
	const m = today.getMonth() - d.getMonth();
	if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
	return age;
}
