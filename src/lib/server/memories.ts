import { db } from '$lib/db';
import { memories, themeFiles, planArtifacts } from '$lib/db/schema';
import { and, eq, desc, gte } from 'drizzle-orm';
import { getRecentReflections } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';

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
 * Opprett et nytt minne. Kun for stabile, kuraterte fakta — bruk reflections,
 * plan_artifacts, dreams, goal_tracks, eller themes.instructions /
 * theme_files.parsed_content for henholdsvis tidsstemplede observasjoner,
 * planlegging, LLM-synteser, mål-spor, tema-instruksjoner og fil-innhold.
 */
export async function createMemory(params: CreateMemoryParams) {
	const {
		userId,
		themeId,
		personId,
		category,
		content,
		importance = 'medium',
		confidence = 'user_confirmed',
		source,
		sourceRef
	} = params;

	const [memory] = await db
		.insert(memories)
		.values({
			userId,
			themeId: themeId || null,
			personId: personId || null,
			category,
			content,
			importance,
			confidence,
			source,
			sourceRef
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
	return await db.query.memories.findMany({
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

/**
 * Bygg kontekst-streng fra alle relevante kilder for chat:
 * - Stabile memories (langtidsfakta)
 * - Aktive plan-artefakter (dag/uke/måned)
 * - Siste refleksjoner
 * - Aktive dreams (LLM-syntese)
 *
 * Hvis themeId oppgis, vises tema-spesifikt fil-innhold ("FILER I TEMAET") først.
 */
export async function buildMemoryContext(userId: string, themeId?: string | null): Promise<string> {
	let fileContext = '';

	if (themeId) {
		const files = await db.query.themeFiles.findMany({
			where: and(eq(themeFiles.themeId, themeId), eq(themeFiles.userId, userId)),
			orderBy: [desc(themeFiles.createdAt)]
		});

		const withContent = files.filter((f) => f.parsedContent && f.parsedContent.trim().length > 0);
		if (withContent.length > 0) {
			fileContext = '\n--- FILER I TEMAET (opplastet innhold) ---\n';
			for (const file of withContent) {
				fileContext += `\n${file.parsedContent}\n`;
			}
			fileContext += '--- SLUTT PÅ TEMA-FILER ---\n';
		}
	}

	const userMemories = await db.query.memories.findMany({
		where: eq(memories.userId, userId),
		orderBy: [desc(memories.importance), desc(memories.lastAccessedAt)],
		limit: 20
	});

	const recentReflections = await getRecentReflections(userId, { sinceDays: 7, limit: 6 });

	const since = new Date();
	since.setDate(since.getDate() - 7);
	const recentPlans = await db.query.planArtifacts.findMany({
		where: and(eq(planArtifacts.userId, userId), gte(planArtifacts.updatedAt, since)),
		orderBy: [desc(planArtifacts.updatedAt)],
		limit: 6
	});

	let context = '';

	if (fileContext) context += fileContext;

	const dream = await DreamService.getActiveDream(userId);
	if (dream && dream.summary) {
		const highlights = (dream.highlights ?? {}) as { mode?: string; rationale?: string };
		context += '\n--- DAGENS DRØM (LLM-syntese, ferdig komprimert) ---\n';
		context += `${dream.summary}\n`;
		if (highlights.mode) {
			context += `Anbefalt modus: ${highlights.mode}${highlights.rationale ? ` — ${highlights.rationale}` : ''}\n`;
		}
		context += '--- SLUTT PÅ DRØM ---\n';
	}

	if (userMemories.length > 0) {
		context += '\n--- MEMORIES (Stabile fakta om brukeren) ---\n';

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

	if (recentPlans.length > 0) {
		context += '\n--- AKTIVE PLANER (siste 7 dager) ---\n';
		for (const plan of recentPlans) {
			const fields: string[] = [];
			if (plan.headline) fields.push(`overskrift: ${plan.headline}`);
			if (plan.note) fields.push(`notat: ${plan.note}`);
			if (plan.reflection) fields.push(`refleksjon: ${plan.reflection}`);
			if (plan.vision) fields.push(`visjon: ${plan.vision}`);
			if (fields.length === 0) continue;
			context += `${plan.kind} ${plan.periodKey}: ${fields.join(' | ')}\n`;
		}
		context += '--- SLUTT PÅ PLANER ---\n';
	}

	if (recentReflections.length > 0) {
		context += '\n--- SISTE REFLEKSJONER ---\n';
		for (const ref of recentReflections) {
			const dateStr = ref.createdAt.toISOString().slice(0, 10);
			context += `[${ref.kind} · ${dateStr}] ${ref.content}\n`;
		}
		context += '--- SLUTT PÅ REFLEKSJONER ---\n';
	}

	if (!context) {
		return '\n--- MEMORIES ---\nIngen lagrede memories ennå.\n--- SLUTT PÅ MEMORIES ---\n';
	}

	return context;
}
