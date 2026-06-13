import { db } from '$lib/db';
import { users, sensorEvents, checklistItems, themes } from '$lib/db/schema';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
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

	// Aktive temaer — for å kunne knytte en epostregel til et tema (f.eks.
	// bibliotek-regel → Bøker).
	const themeOptions = await db
		.select({ id: themes.id, name: themes.name, emoji: themes.emoji })
		.from(themes)
		.where(and(eq(themes.userId, locals.userId), eq(themes.archived, false)))
		.orderBy(asc(themes.sortOrder), asc(themes.createdAt));

	return {
		user: user || null,
		emailEndpoint: endpoint,
		emailWebhookConfigured: token.length > 0,
		emailAppsScriptSource: appsScriptSource,
		emailImports,
		themes: themeOptions
	};
};
