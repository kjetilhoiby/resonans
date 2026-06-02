import { db } from '$lib/db';
import { users, sensorEvents, checklistItems, persons } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { ensureUser } from '$lib/server/users';
import { buildAppsScript } from '$lib/server/email/apps-script-template';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	await ensureUser(locals.userId);

	const user = await db.query.users.findFirst({
		where: eq(users.id, locals.userId)
	});

	const origin = env.ORIGIN ?? url.origin;
	const endpoint = `${origin.replace(/\/$/, '')}/api/email/inbound`;
	const token = env.EMAIL_WEBHOOK_SECRET ?? '';

	const appsScriptSource = token
		? buildAppsScript({ endpoint, token })
		: null;

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const [workoutCountRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, locals.userId),
				gte(sensorEvents.createdAt, sevenDaysAgo),
				sql`metadata->>'source' = 'email'`,
				sql`data_type = 'workout'`
			)
		);

	const [libraryCountRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.userId, locals.userId),
				gte(checklistItems.createdAt, sevenDaysAgo),
				sql`metadata->>'source' = 'email_inbound'`
			)
		);

	const emailImports = {
		last7Days: (workoutCountRow?.count ?? 0) + (libraryCountRow?.count ?? 0),
		workouts: workoutCountRow?.count ?? 0,
		libraryItems: libraryCountRow?.count ?? 0
	};

	// Personer (barn først) for person-ruting av skole-/barnehage-eposter.
	const peopleRows = await db.query.persons.findMany({
		where: and(eq(persons.userId, locals.userId), eq(persons.archived, false)),
		columns: { id: true, name: true, kind: true },
		orderBy: (p, { asc }) => [asc(p.name)]
	});
	const people = peopleRows.map((p) => ({ id: p.id, name: p.name, kind: p.kind }));

	return {
		user: user || null,
		emailEndpoint: endpoint,
		emailWebhookConfigured: token.length > 0,
		emailAppsScriptSource: appsScriptSource,
		emailImports,
		people
	};
};
