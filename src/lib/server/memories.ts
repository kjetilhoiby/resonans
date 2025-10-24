import { db } from '$lib/db';
import { memories } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface CreateMemoryParams {
	userId: string;
	category: 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'other';
	content: string;
	importance?: 'high' | 'medium' | 'low';
	source?: string;
}

/**
 * Opprett et nytt minne
 */
export async function createMemory(params: CreateMemoryParams) {
	const { userId, category, content, importance = 'medium', source } = params;

	const [memory] = await db
		.insert(memories)
		.values({
			userId,
			category,
			content,
			importance,
			source
		})
		.returning();

	return memory;
}

/**
 * Hent alle memories for en bruker, sortert etter viktighet og nyhet
 */
export async function getUserMemories(userId: string, limit = 20) {
	return await db.query.memories.findMany({
		where: eq(memories.userId, userId),
		orderBy: [
			// Viktige memories først
			desc(memories.importance),
			// Deretter de som er tilgjengelige sist
			desc(memories.lastAccessedAt)
		],
		limit
	});
}

/**
 * Oppdater lastAccessedAt for et minne (når AI bruker det)
 */
export async function touchMemory(memoryId: string) {
	await db
		.update(memories)
		.set({ lastAccessedAt: new Date() })
		.where(eq(memories.id, memoryId));
}

/**
 * Slett et minne
 */
export async function deleteMemory(memoryId: string) {
	await db.delete(memories).where(eq(memories.id, memoryId));
}

/**
 * Bygg kontekst-streng fra memories
 */
export async function buildMemoryContext(userId: string): Promise<string> {
	const userMemories = await getUserMemories(userId);

	if (userMemories.length === 0) {
		return '\n--- MEMORIES ---\nIngen lagrede memories ennå.\n--- SLUTT PÅ MEMORIES ---\n';
	}

	let context = '\n--- MEMORIES (Viktig informasjon om brukeren) ---\n';
	
	// Grupper etter kategori
	const categorized = userMemories.reduce((acc, mem) => {
		if (!acc[mem.category]) acc[mem.category] = [];
		acc[mem.category].push(mem);
		return acc;
	}, {} as Record<string, typeof userMemories>);

	for (const [category, mems] of Object.entries(categorized)) {
		context += `\n${category.toUpperCase()}:\n`;
		for (const mem of mems) {
			const importanceSymbol = mem.importance === 'high' ? '⭐' : mem.importance === 'medium' ? '•' : '-';
			context += `${importanceSymbol} ${mem.content}\n`;
		}
	}

	context += '\n--- SLUTT PÅ MEMORIES ---\n';

	// Touch alle memories som brukes
	for (const mem of userMemories) {
		await touchMemory(mem.id);
	}

	return context;
}
