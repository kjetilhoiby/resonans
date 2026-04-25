import { db } from '$lib/db';
import { memories, taskFiles } from '$lib/db/schema';
import { and, eq, desc, like, not, inArray } from 'drizzle-orm';

export const THEME_FILE_MEMORY_SOURCE_PREFIX = 'theme_file:';
export const TASK_FILE_MEMORY_SOURCE_PREFIX = 'task_file:';

export interface CreateMemoryParams {
	userId: string;
	themeId?: string | null;
	category: 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'other';
	content: string;
	importance?: 'high' | 'medium' | 'low';
	source?: string;
}

/**
 * Opprett et nytt minne (kan være generelt eller tema-spesifikt)
 */
export async function createMemory(params: CreateMemoryParams) {
	const { userId, themeId, category, content, importance = 'medium', source } = params;

	const [memory] = await db
		.insert(memories)
		.values({
			userId,
			themeId: themeId || null,
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
 * Slett alle memories med en gitt source-verdi (brukes f.eks. når en tematil knyttet fil slettes)
 */
export async function deleteMemoryBySource(source: string) {
	await db.delete(memories).where(eq(memories.source, source));
}

/**
 * Bygg kontekst-streng for filer knyttet til en task (prosjekt). Brukes når
 * en samtale er bundet til en task — gir LLM tilgang til opplastet innhold.
 */
export async function buildTaskFileContext(userId: string, taskId: string): Promise<string> {
	const files = await db
		.select({ id: taskFiles.id, name: taskFiles.name })
		.from(taskFiles)
		.where(and(eq(taskFiles.taskId, taskId), eq(taskFiles.userId, userId)));

	if (files.length === 0) return '';

	const sources = files.map((f) => `${TASK_FILE_MEMORY_SOURCE_PREFIX}${f.id}`);
	const fileMemories = await db.query.memories.findMany({
		where: and(eq(memories.userId, userId), inArray(memories.source, sources)),
		orderBy: [desc(memories.updatedAt)]
	});

	if (fileMemories.length === 0) return '';

	let context = '\n--- FILER I PROSJEKTET (opplastet innhold) ---\n';
	for (const mem of fileMemories) {
		context += `\n${mem.content}\n`;
	}
	context += '--- SLUTT PÅ PROSJEKT-FILER ---\n';
	return context;
}

/**
 * Bygg kontekst-streng fra memories.
 *
 * Hvis themeId oppgis vises tema-spesifikke fil-minner (“FILER I TEMAET”) før vanlige memories.
 */
export async function buildMemoryContext(userId: string, themeId?: string | null): Promise<string> {
	let fileContext = '';

	// ── Tema-filer (parsed innhold) ─────────────────────────────
	if (themeId) {
		const fileMemories = await db.query.memories.findMany({
			where: and(
				eq(memories.userId, userId),
				eq(memories.themeId, themeId),
				like(memories.source, `${THEME_FILE_MEMORY_SOURCE_PREFIX}%`)
			),
			orderBy: [desc(memories.updatedAt)]
		});

		if (fileMemories.length > 0) {
			fileContext = '\n--- FILER I TEMAET (opplastet innhold) ---\n';
			for (const mem of fileMemories) {
				fileContext += `\n${mem.content}\n`;
			}
			fileContext += '--- SLUTT PÅ TEMA-FILER ---\n';
		}
	}

	// ── Vanlige memories (ekskluder fil-minner som allerede er inkludert) ───
	const userMemories = await db.query.memories.findMany({
		where: and(
			eq(memories.userId, userId),
			not(like(memories.source, `${THEME_FILE_MEMORY_SOURCE_PREFIX}%`))
		),
		orderBy: [desc(memories.importance), desc(memories.lastAccessedAt)],
		limit: 20
	});

	if (userMemories.length === 0 && !fileContext) {
		return '\n--- MEMORIES ---\nIngen lagrede memories ennå.\n--- SLUTT PÅ MEMORIES ---\n';
	}

	let context = '';

	if (fileContext) context += fileContext;

	if (userMemories.length > 0) {
		context += '\n--- MEMORIES (Viktig informasjon om brukeren) ---\n';

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

		for (const mem of userMemories) {
			await touchMemory(mem.id);
		}
	}

	return context;
}
