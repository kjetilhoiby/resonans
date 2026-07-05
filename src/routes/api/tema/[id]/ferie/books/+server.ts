import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { books, bookProgressLog } from '$lib/db/schema';
import { and, asc, eq, lt } from 'drizzle-orm';

// Bøker med registrert lesing i ferievinduet: alle brukerens bøker (på tvers
// av temaer) som har fremdriftslogg-punkter i [start, end], med siste punkt
// før vinduet som baseline. Serieberegningen (økning, lesestart/-slutt) skjer
// i $lib/ferie/ferie-reading — endepunktet leverer bare rådata.
export const GET: RequestHandler = async ({ url, locals }) => {
	const start = url.searchParams.get('start') ?? '';
	const end = url.searchParams.get('end') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
		return json({ error: 'start og end (YYYY-MM-DD) er påkrevd' }, { status: 400 });
	}

	const bookRows = await db
		.select({
			id: books.id,
			themeId: books.themeId,
			title: books.title,
			author: books.author,
			coverUrl: books.coverUrl,
			format: books.format,
			totalPages: books.totalPages,
			totalMinutes: books.totalMinutes
		})
		.from(books)
		.where(eq(books.userId, locals.userId));
	if (bookRows.length === 0) return json({ books: [] });

	const endExclusive = new Date(Date.parse(end + 'T00:00:00Z') + 86_400_000);
	const logRows = await db
		.select()
		.from(bookProgressLog)
		.where(and(eq(bookProgressLog.userId, locals.userId), lt(bookProgressLog.loggedAt, endExclusive)))
		.orderBy(asc(bookProgressLog.loggedAt));

	const logByBook = new Map<string, typeof logRows>();
	for (const row of logRows) {
		const list = logByBook.get(row.bookId);
		if (list) list.push(row);
		else logByBook.set(row.bookId, [row]);
	}

	const result = [];
	for (const book of bookRows) {
		const log = logByBook.get(book.id) ?? [];
		const firstInWindow = log.findIndex((r) => r.loggedAt.toISOString().slice(0, 10) >= start);
		if (firstInWindow === -1) continue;
		// Ta med punktet rett før vinduet som baseline («hvor langt var jeg da
		// ferien begynte»).
		const slice = log.slice(Math.max(firstInWindow - 1, 0));
		result.push({
			...book,
			points: slice.map((r) => ({
				loggedAt: r.loggedAt.toISOString(),
				currentPage: r.currentPage,
				currentMinutes: r.currentMinutes
			}))
		});
	}

	return json({ books: result });
};
