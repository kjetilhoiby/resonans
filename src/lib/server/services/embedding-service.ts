import { openai } from '$lib/server/openai';

/**
 * Tynn wrapper rundt OpenAI embeddings. Embeddings er berikelse — aldri
 * blokkerende: ved feil returneres null og kalleren fortsetter uten
 * (skrivestien lagrer raden, findSimilar faller tilbake til ILIKE).
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** Maks tegn som embeddes — lange tekster (transkripter) kuttes; starten bærer temaet. */
const MAX_INPUT_CHARS = 8000;

export async function generateEmbedding(text: string): Promise<number[] | null> {
	const input = text.trim();
	if (!input) return null;
	try {
		const res = await openai.embeddings.create({
			model: EMBEDDING_MODEL,
			input: input.slice(0, MAX_INPUT_CHARS)
		});
		const embedding = res.data[0]?.embedding;
		return Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONS
			? embedding
			: null;
	} catch (err) {
		console.error('[embedding] generering feilet:', err);
		return null;
	}
}
