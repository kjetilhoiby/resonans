import { db } from '$lib/db';
import { dreams, memories } from '$lib/db/schema';
import { and, cosineDistance, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { createMemory } from '$lib/server/memories';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import type { DreamHighlights } from '$lib/server/services/dream-service';

/**
 * Minste cosine-likhet for at to memories regnes som «samme sak».
 * text-embedding-3-small på korte norske setninger: omformuleringer av samme
 * verdi lander typisk 0.6–0.8; urelaterte utsagn under 0.4.
 */
const SIMILARITY_THRESHOLD = 0.6;

export interface MemoryCandidate {
	content: string;
	category: 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'values' | 'health_baseline' | 'other';
	importance: 'high' | 'medium' | 'low';
	sourceRef?: { kind: string; id?: string };
}

/**
 * MemoryService håndterer kuratering av memories — det som skiller en
 * memory-rad fra en flyktig observasjon. Bare CRUD ligger fortsatt i
 * `memories.ts`; her kommer logikk som dedup, supersede, decay og
 * LLM-foreslag.
 */
export class MemoryService {
	/**
	 * Plukker kandidater til stabile memories ut av en drøm. Siden synthesis
	 * og envision allerede har destillert wins/frictions, er det naturlig
	 * å vurdere dem som kandidater (med confidence='llm_inferred').
	 */
	static async proposeFromDream(dreamId: string): Promise<MemoryCandidate[]> {
		const dream = await db.query.dreams.findFirst({ where: eq(dreams.id, dreamId) });
		if (!dream) return [];

		const highlights = (dream.highlights ?? {}) as Partial<DreamHighlights>;
		const candidates: MemoryCandidate[] = [];

		for (const win of highlights.wins ?? []) {
			candidates.push({
				content: win,
				category: dream.kind.startsWith('vision_') ? 'values' : 'personal',
				importance: 'medium',
				sourceRef: { kind: 'dream', id: dream.id }
			});
		}
		for (const friction of highlights.frictions ?? []) {
			candidates.push({
				content: friction,
				category: 'personal',
				importance: 'medium',
				sourceRef: { kind: 'dream', id: dream.id }
			});
		}
		return candidates;
	}

	/**
	 * Aksepterer en kandidat: dedup mot eksisterende memories, og enten
	 * skriver ny eller supersederer matching eldre.
	 */
	static async accept(
		userId: string,
		candidate: MemoryCandidate,
		opts: { confidence?: 'user_confirmed' | 'llm_inferred' | 'imported' } = {}
	) {
		const match = await this.findSimilar(userId, candidate.content, candidate.category);
		const created = await createMemory({
			userId,
			category: candidate.category,
			content: candidate.content,
			importance: candidate.importance,
			confidence: opts.confidence ?? 'llm_inferred',
			sourceRef: candidate.sourceRef
		});
		if (match && created) {
			await this.supersede(match.id, created.id);
		}
		return created;
	}

	/**
	 * Finner en eksisterende memory som handler om det samme. Primært
	 * embedding-likhet (cosine) — fanger omformuleringer («Nærvær med barna» ≈
	 * «Være til stede for ungene»). Faller tilbake til ILIKE-token-overlapp når
	 * embedding ikke kan genereres (API-feil, tom tekst).
	 */
	static async findSimilar(userId: string, content: string, category: string) {
		const embedding = await generateEmbedding(content);
		if (embedding) {
			const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, embedding)})`;
			const [match] = await db
				.select({ memory: memories, similarity })
				.from(memories)
				.where(
					and(
						eq(memories.userId, userId),
						eq(memories.category, category),
						isNotNull(memories.embedding),
						// Aldri match en supersedert rad — accept() ville brutt kjeden dens
						isNull(memories.supersededBy)
					)
				)
				.orderBy(desc(similarity))
				.limit(1);
			if (match && match.similarity >= SIMILARITY_THRESHOLD) return match.memory;
			// Embedding fantes men ingenting lignet — ikke fall tilbake til løsere ILIKE
			return null;
		}

		const tokens = content
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length >= 4)
			.slice(0, 3);

		if (tokens.length === 0) return null;

		const conds = tokens.map((tok) => ilike(memories.content, `%${tok}%`));
		return db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.category, category), or(...conds)),
			orderBy: [desc(memories.lastAccessedAt)]
		});
	}

	static async supersede(oldId: string, newId: string) {
		await db.update(memories).set({ supersededBy: newId }).where(eq(memories.id, oldId));
	}
}
