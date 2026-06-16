import { json } from '@sveltejs/kit';
import { loadKavalkadeData } from '$lib/server/kavalkade-data';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import { buildGreetingsMarkdown } from '$lib/kavalkade-magi';
import { generateGreetings, generateProphecy } from '$lib/server/kavalkade-magi-gen';
import type { RequestHandler } from './$types';

/**
 * AI-generert bursdagsmagi for kavalkaden: «spådommen» for året som kommer,
 * og bursdagshilsner fra romankarakterer i årets bøker. Resultatet lagres
 * som én refleksjon per år og kan genereres på nytt (upsert).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const kind = body?.kind;
	if (kind !== 'prophecy' && kind !== 'greetings') {
		return json({ error: 'Ukjent magi-type' }, { status: 400 });
	}

	const data = await loadKavalkadeData(locals.userId);

	if (kind === 'prophecy') {
		const content = await generateProphecy(data);
		if (!content) return json({ error: 'Kunne ikke generere spådom' }, { status: 502 });
		await upsertReflectionForPeriod({
			userId: locals.userId,
			kind: 'birthday_prophecy',
			periodKey: data.interview.thisYearKey,
			content
		});
		return json({ ok: true, content });
	}

	// Hilsner trenger bøker å hente karakterer fra — årets først, ellers fjorårets
	const sourceBooks = data.current.books.length > 0 ? data.current.books : data.previous.books;
	if (sourceBooks.length === 0) {
		return json({ error: 'Ingen ferdigleste bøker å hente karakterer fra' }, { status: 400 });
	}
	const greetings = await generateGreetings(sourceBooks.slice(-5), data);
	if (greetings.length === 0) {
		return json({ error: 'Kunne ikke generere hilsner' }, { status: 502 });
	}
	await upsertReflectionForPeriod({
		userId: locals.userId,
		kind: 'birthday_greetings',
		periodKey: data.interview.thisYearKey,
		content: buildGreetingsMarkdown(greetings)
	});
	return json({ ok: true, greetings });
};
