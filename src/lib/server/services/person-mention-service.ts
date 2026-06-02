import { db } from '$lib/db';
import {
	messagePersonMentions,
	taskPersonMentions,
	checklistItemPersonMentions,
	messages,
	tasks,
	checklistItems,
	persons
} from '$lib/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PersonService } from './person-service';

/**
 * Lett tekst-basert mention-deteksjon. Finner navn/aliaser fra brukerens persons-tabell
 * som forekommer som hele ord (case-insensitive) i den gitte teksten.
 *
 * Det er bevisst enkelt — hovedformålet er å lage en søkbar indeks; presisjon kan
 * forbedres senere med GPT-4o-mini eller bruker-bekreftelse.
 */
export interface DetectedMention {
	personId: string;
	confidence: 'explicit' | 'inferred';
}

export async function detectPersonMentions(
	userId: string,
	text: string
): Promise<DetectedMention[]> {
	if (!text || text.length < 2) return [];
	const lexicon = await PersonService.getMentionLexicon(userId);
	if (lexicon.length === 0) return [];

	const matches = new Map<string, DetectedMention>();
	const normalized = text.toLowerCase();

	function record(personId: string, confidence: 'explicit' | 'inferred') {
		const existing = matches.get(personId);
		// 'explicit' overstyrer 'inferred'
		if (!existing || (existing.confidence === 'inferred' && confidence === 'explicit')) {
			matches.set(personId, { personId, confidence });
		}
	}

	for (const { personId, tokens } of lexicon) {
		for (const token of tokens) {
			if (!token || token.length < 2) continue;
			const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// Eksplisitt: @-prefiks rett før hele tokenet (matcher @-mention fra autocomplete)
			const explicitRe = new RegExp(`(^|\\s)@${escaped}([^\\p{L}\\p{N}]|$)`, 'iu');
			if (explicitRe.test(text)) {
				record(personId, 'explicit');
				break;
			}
			// Inferred: hele-ord match uten @-prefiks
			const re = new RegExp(`(^|[^\\p{L}\\p{N}@])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu');
			if (re.test(text)) {
				record(personId, 'inferred');
				break;
			}
			if (token.length >= 4 && normalized.includes(token.toLowerCase())) {
				record(personId, 'inferred');
				break;
			}
		}
	}
	return Array.from(matches.values());
}

export class PersonMentionService {
	/**
	 * Skriv mentions for en gitt melding. Returnerer antall nye rader.
	 */
	static async indexMessage(
		userId: string,
		messageId: string,
		content: string,
		explicitPersonIds: string[] = []
	): Promise<number> {
		const detected = await detectPersonMentions(userId, content);

		const merged = new Map<string, DetectedMention>();
		for (const m of detected) merged.set(m.personId, m);
		for (const id of explicitPersonIds) {
			merged.set(id, { personId: id, confidence: 'explicit' });
		}
		if (merged.size === 0) return 0;

		const rows = Array.from(merged.values()).map((m) => ({
			userId,
			messageId,
			personId: m.personId,
			confidence: m.confidence
		}));

		const inserted = await db
			.insert(messagePersonMentions)
			.values(rows)
			.onConflictDoUpdate({
				target: [messagePersonMentions.messageId, messagePersonMentions.personId],
				set: { confidence: sql`EXCLUDED.confidence` }
			})
			.returning({ id: messagePersonMentions.id });
		return inserted.length;
	}

	/**
	 * Skriv mentions for en task basert på tittel + beskrivelse.
	 */
	static async indexTask(
		userId: string,
		taskId: string,
		title: string,
		description?: string | null,
		explicitPersonIds: string[] = []
	): Promise<number> {
		const text = [title, description ?? ''].filter(Boolean).join(' ');
		const detected = await detectPersonMentions(userId, text);
		const merged = new Map<string, DetectedMention>();
		for (const m of detected) merged.set(m.personId, m);
		for (const id of explicitPersonIds) {
			merged.set(id, { personId: id, confidence: 'explicit' });
		}
		if (merged.size === 0) return 0;
		const rows = Array.from(merged.values()).map((m) => ({
			userId,
			taskId,
			personId: m.personId,
			confidence: m.confidence
		}));
		const inserted = await db
			.insert(taskPersonMentions)
			.values(rows)
			.onConflictDoUpdate({
				target: [taskPersonMentions.taskId, taskPersonMentions.personId],
				set: { confidence: sql`EXCLUDED.confidence` }
			})
			.returning({ id: taskPersonMentions.id });
		return inserted.length;
	}

	/**
	 * Skriv mentions for et checklist-item (dag-task) basert på teksten.
	 */
	static async indexChecklistItem(
		userId: string,
		checklistItemId: string,
		text: string,
		explicitPersonIds: string[] = []
	): Promise<number> {
		const detected = await detectPersonMentions(userId, text);
		const merged = new Map<string, DetectedMention>();
		for (const m of detected) merged.set(m.personId, m);
		for (const id of explicitPersonIds) {
			merged.set(id, { personId: id, confidence: 'explicit' });
		}
		if (merged.size === 0) return 0;
		const rows = Array.from(merged.values()).map((m) => ({
			userId,
			checklistItemId,
			personId: m.personId,
			confidence: m.confidence
		}));
		const inserted = await db
			.insert(checklistItemPersonMentions)
			.values(rows)
			.onConflictDoUpdate({
				target: [checklistItemPersonMentions.checklistItemId, checklistItemPersonMentions.personId],
				set: { confidence: sql`EXCLUDED.confidence` }
			})
			.returning({ id: checklistItemPersonMentions.id });
		return inserted.length;
	}

	static async listChecklistItemMentionsForPerson(
		userId: string,
		personId: string,
		opts?: { limit?: number; includeChecked?: boolean }
	) {
		const limit = opts?.limit ?? 50;
		const rows = await db
			.select({
				mention: checklistItemPersonMentions,
				item: checklistItems
			})
			.from(checklistItemPersonMentions)
			.innerJoin(checklistItems, eq(checklistItemPersonMentions.checklistItemId, checklistItems.id))
			.where(
				and(
					eq(checklistItemPersonMentions.userId, userId),
					eq(checklistItemPersonMentions.personId, personId)
				)
			)
			.orderBy(desc(checklistItems.createdAt))
			.limit(limit * 2);
		if (opts?.includeChecked) return rows.slice(0, limit);
		return rows.filter((r) => !r.item.checked).slice(0, limit);
	}

	static async listMessageMentionsForPerson(
		userId: string,
		personId: string,
		opts?: { limit?: number }
	) {
		const limit = opts?.limit ?? 50;
		return db
			.select({
				mention: messagePersonMentions,
				message: messages
			})
			.from(messagePersonMentions)
			.innerJoin(messages, eq(messagePersonMentions.messageId, messages.id))
			.where(
				and(
					eq(messagePersonMentions.userId, userId),
					eq(messagePersonMentions.personId, personId)
				)
			)
			.orderBy(desc(messages.createdAt))
			.limit(limit);
	}

	static async listTaskMentionsForPerson(
		userId: string,
		personId: string,
		opts?: { limit?: number; includeCompleted?: boolean }
	) {
		const limit = opts?.limit ?? 50;
		const conds = [
			eq(taskPersonMentions.userId, userId),
			eq(taskPersonMentions.personId, personId)
		];
		const rows = await db
			.select({
				mention: taskPersonMentions,
				task: tasks
			})
			.from(taskPersonMentions)
			.innerJoin(tasks, eq(taskPersonMentions.taskId, tasks.id))
			.where(and(...conds))
			.orderBy(desc(tasks.createdAt))
			.limit(limit * 2);
		if (opts?.includeCompleted) return rows.slice(0, limit);
		return rows.filter((r) => r.task.status === 'active').slice(0, limit);
	}

	/**
	 * Bruker-brede mention-lister (på tvers av alle personer) — brukes av den
	 * samlede familie-feeden. Speiler *ForPerson-metodene, men uten personId-filter.
	 */
	static async listMessageMentionsForUser(userId: string, opts?: { limit?: number }) {
		const limit = opts?.limit ?? 100;
		return db
			.select({
				mention: messagePersonMentions,
				message: messages
			})
			.from(messagePersonMentions)
			.innerJoin(messages, eq(messagePersonMentions.messageId, messages.id))
			.where(eq(messagePersonMentions.userId, userId))
			.orderBy(desc(messages.createdAt))
			.limit(limit);
	}

	static async listTaskMentionsForUser(
		userId: string,
		opts?: { limit?: number; includeCompleted?: boolean }
	) {
		const limit = opts?.limit ?? 100;
		const rows = await db
			.select({
				mention: taskPersonMentions,
				task: tasks
			})
			.from(taskPersonMentions)
			.innerJoin(tasks, eq(taskPersonMentions.taskId, tasks.id))
			.where(eq(taskPersonMentions.userId, userId))
			.orderBy(desc(tasks.createdAt))
			.limit(limit * 2);
		if (opts?.includeCompleted) return rows.slice(0, limit);
		return rows.filter((r) => r.task.status === 'active').slice(0, limit);
	}

	static async listChecklistItemMentionsForUser(
		userId: string,
		opts?: { limit?: number; includeChecked?: boolean }
	) {
		const limit = opts?.limit ?? 100;
		const rows = await db
			.select({
				mention: checklistItemPersonMentions,
				item: checklistItems
			})
			.from(checklistItemPersonMentions)
			.innerJoin(checklistItems, eq(checklistItemPersonMentions.checklistItemId, checklistItems.id))
			.where(eq(checklistItemPersonMentions.userId, userId))
			.orderBy(desc(checklistItems.createdAt))
			.limit(limit * 2);
		if (opts?.includeChecked) return rows.slice(0, limit);
		return rows.filter((r) => !r.item.checked).slice(0, limit);
	}

	static async getMentionsForMessages(userId: string, messageIds: string[]) {
		if (messageIds.length === 0) return [];
		return db
			.select({
				mention: messagePersonMentions,
				person: persons
			})
			.from(messagePersonMentions)
			.innerJoin(persons, eq(messagePersonMentions.personId, persons.id))
			.where(
				and(
					eq(messagePersonMentions.userId, userId),
					inArray(messagePersonMentions.messageId, messageIds)
				)
			);
	}
}
