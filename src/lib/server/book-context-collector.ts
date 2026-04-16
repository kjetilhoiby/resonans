import { db } from '$lib/db';
import { books } from '$lib/db/schema';
import { openai } from '$lib/server/openai';
import { eq } from 'drizzle-orm';

export interface BookContextPack {
	metadata?: { year?: number; genre?: string };
	authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
	themes?: string[];
	reception?: { critics?: string; readers?: string; patterns?: string[] };
	relatedWorks?: string[];
	conversationHints?: string[];
}

export async function processBookContextCollectJob(payload: {
	bookId: string;
	title: string;
	author: string | null;
}): Promise<BookContextPack> {
	const { bookId, title, author } = payload;

	const authorLine = author ? ` av ${author}` : '';

	const systemPrompt = `Du er en litterær assistent som henter kontekst om bøker.
Returner alltid et gyldig JSON-objekt med strukturen under.
Vær kortfattet og fokuser på det som er genuint nyttig i en samtale om boken.`;

	const userPrompt = `Hent kontekst for boken "${title}"${authorLine}.

Returner JSON med denne strukturen:
{
  "metadata": {
    "year": <utgivelsesår som tall eller null>,
    "genre": "<sjanger>"
  },
  "authorContext": {
    "bio": "<1-2 setninger om forfatteren>",
    "themes": ["<gjennomgående tema 1>", "<tema 2>"],
    "howBookFits": "<1 setning om hvordan boken passer inn i forfatterskapet>"
  },
  "themes": ["<sentralt tema 1>", "<tema 2>", "<tema 3>"],
  "reception": {
    "critics": "<1-2 setninger om kritikermottakelse>",
    "readers": "<1-2 setninger om hvordan vanlige lesere opplever boken>",
    "patterns": ["<typisk leserreaksjon 1>", "<reaksjon 2>"]
  },
  "relatedWorks": ["<beslektet bok 1>", "<beslektet bok 2>"],
  "conversationHints": [
    "<spørsmål eller observasjon som åpner boken 1>",
    "<hint 2>",
    "<hint 3>"
  ]
}

Returner kun JSON, ingen annen tekst.`;

	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		],
		response_format: { type: 'json_object' },
		max_tokens: 800,
		temperature: 0.3
	});

	const raw = response.choices[0]?.message?.content ?? '{}';
	let contextPack: BookContextPack;
	try {
		contextPack = JSON.parse(raw) as BookContextPack;
	} catch {
		contextPack = {};
	}

	// Persist context pack to the book record
	await db
		.update(books)
		.set({
			contextPack,
			contextStatus: 'ready',
			updatedAt: new Date()
		})
		.where(eq(books.id, bookId));

	return contextPack;
}
