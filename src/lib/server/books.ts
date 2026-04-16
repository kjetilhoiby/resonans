import { db } from '$lib/db';
import { books } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { openai } from '$lib/server/openai';

export interface BookDetectionResult {
	bookId: string | null;
	bookTitle: string | null;
	themeId: string | null;
	confidence: 'high' | 'medium' | 'low' | 'none';
}

export async function detectBookForMessage(
	message: string,
	userId: string
): Promise<BookDetectionResult> {
	const userBooks = await db.query.books.findMany({
		where: eq(books.userId, userId),
		columns: { id: true, title: true, author: true, themeId: true }
	});

	if (userBooks.length === 0) {
		return { bookId: null, bookTitle: null, themeId: null, confidence: 'none' };
	}

	const bookList = userBooks
		.map((b) => `- ID: ${b.id}, Tittel: "${b.title}"${b.author ? `, Forfatter: ${b.author}` : ''}`)
		.join('\n');

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content:
						'Du er et bok-routing-system. Analyser meldinger og avgjør om brukeren vil snakke om en bestemt bok. Vær raus med matching: uformelle referanser som forfatterens etternavn + "-boka" (f.eks. "Tjønn-boka"), forkortelser, deler av tittel, eller bare forfatternavn skal matches. Svar alltid med valid JSON.'
				},
				{
					role: 'user',
					content: `Brukermelding: "${message}"\n\nBrukerens bøker:\n${bookList}\n\nAvgjør om meldingen refererer til en av disse bøkene. Bruk fuzzy matching — "Tjønn-boka" matcher en bok av forfatter Tjønn, "den boka" i kontekst av en bok matches også.\n\nSvar med:\n{"bookId":"uuid-eller-null","confidence":"high|medium|low|none"}`
				}
			],
			response_format: { type: 'json_object' },
			max_tokens: 80,
			temperature: 0
		});

		const raw = completion.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(raw) as { bookId?: string; confidence?: string };

		if (!parsed.bookId || parsed.confidence === 'none' || !parsed.confidence) {
			return { bookId: null, bookTitle: null, themeId: null, confidence: 'none' };
		}

		const book = userBooks.find((b) => b.id === parsed.bookId);
		if (!book) return { bookId: null, bookTitle: null, themeId: null, confidence: 'none' };

		const confidence = (
			parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
				? parsed.confidence
				: 'low'
		) as 'high' | 'medium' | 'low';

		return { bookId: book.id, bookTitle: book.title, themeId: book.themeId, confidence };
	} catch (err) {
		console.warn('⚠️ Book detection failed:', err);
		return { bookId: null, bookTitle: null, themeId: null, confidence: 'none' };
	}
}
