import { json, error } from '@sveltejs/kit';
import { db, rowsOf } from '$lib/db';
import { messages, conversations } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import type { RequestHandler } from './$types';

/**
 * Dager med meldinger i en samtale — grunnlag for kalender-markørene i chatten.
 *
 * `created_at` lagres som UTC-veggtid (defaultNow), mens klientens dag-ankere
 * (`dag-YYYY-MM-DD`) bruker lokal tid. Derfor konverteres til klientens tidssone
 * (?tz=, IANA-navn) server-side slik at markørene stemmer med ankrene.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	await ensureConversationThemeIdColumn();

	const conv = await db.query.conversations.findFirst({
		where: and(eq(conversations.id, params.id), eq(conversations.userId, locals.userId))
	});
	if (!conv) error(404, 'Samtale ikke funnet');

	const tzParam = url.searchParams.get('tz') ?? '';
	const tz = /^[A-Za-z_]+\/[A-Za-z_+-]+$/.test(tzParam) ? tzParam : 'Europe/Oslo';

	const days = rowsOf<{ day: string; count: number }>(
		await db.execute(sql`
			select ((${messages.createdAt} at time zone 'UTC') at time zone ${tz})::date::text as day,
			       count(*)::int as count
			from ${messages}
			where ${messages.conversationId} = ${params.id}
			  and ${messages.role} <> 'system'
			group by 1
			order by 1
		`)
	);

	return json({ days });
};
