import { db } from '$lib/db';
import { memories } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

export interface CreateMemoryParams {
	userId: string;
	themeId?: string | null;
	personId?: string | null;
	category: 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'values' | 'health_baseline' | 'other';
	content: string;
	importance?: 'high' | 'medium' | 'low';
	confidence?: 'user_confirmed' | 'llm_inferred' | 'imported';
	source?: string;
	sourceRef?: { kind: string; id?: string };
}

/**
 * Opprett et nytt minne. Kun for stabile, kuraterte fakta — bruk
 * - reflections for tidsstemplede observasjoner
 * - plan_artifacts for planlegging
 * - dreams for LLM-synteser og visjoner
 * - goal_tracks for mål-spor
 * - themes.instructions for tema-instruksjoner
 * - theme_files.parsed_content for fil-innhold
 */
export async function createMemory(params: CreateMemoryParams) {
	const [memory] = await db
		.insert(memories)
		.values({
			userId: params.userId,
			themeId: params.themeId || null,
			personId: params.personId || null,
			category: params.category,
			content: params.content,
			importance: params.importance ?? 'medium',
			confidence: params.confidence ?? 'user_confirmed',
			source: params.source,
			sourceRef: params.sourceRef
		})
		.returning();
	return memory;
}

export async function getMemoriesForPerson(userId: string, personId: string, limit = 20) {
	return db.query.memories.findMany({
		where: and(eq(memories.userId, userId), eq(memories.personId, personId)),
		orderBy: [desc(memories.importance), desc(memories.createdAt)],
		limit
	});
}

export async function getUserMemories(userId: string, limit = 20) {
	return db.query.memories.findMany({
		where: eq(memories.userId, userId),
		orderBy: [desc(memories.importance), desc(memories.lastAccessedAt)],
		limit
	});
}

export async function touchMemory(memoryId: string) {
	await db
		.update(memories)
		.set({ lastAccessedAt: new Date() })
		.where(eq(memories.id, memoryId));
}

export async function deleteMemory(memoryId: string) {
	await db.delete(memories).where(eq(memories.id, memoryId));
}
