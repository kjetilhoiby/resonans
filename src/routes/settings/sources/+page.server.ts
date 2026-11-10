import { db } from '$lib/db';
import { users, persons, emailInboundLog } from '$lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { ensureUser } from '$lib/server/users';
import { buildAppsScript } from '$lib/server/email/apps-script-template';
import { describeInboundHealth } from '$lib/server/email/inbound';
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

	// Innboks-loggen (migrasjon 0079): siste e-poster og om scriptet er oppdatert.
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const recentRows = await db
		.select({
			id: emailInboundLog.id,
			label: emailInboundLog.label,
			fromAddress: emailInboundLog.fromAddress,
			subject: emailInboundLog.subject,
			status: emailInboundLog.status,
			rules: emailInboundLog.rules,
			error: emailInboundLog.error,
			attempts: emailInboundLog.attempts,
			scriptVersion: emailInboundLog.scriptVersion,
			updatedAt: emailInboundLog.updatedAt
		})
		.from(emailInboundLog)
		.where(eq(emailInboundLog.userId, locals.userId))
		.orderBy(desc(emailInboundLog.updatedAt))
		.limit(10);
	const [weekRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(emailInboundLog)
		.where(and(eq(emailInboundLog.userId, locals.userId), gte(emailInboundLog.createdAt, sevenDaysAgo)));

	const latest = recentRows[0] ?? null;
	const emailInbound = {
		last7Days: weekRow?.count ?? 0,
		health: describeInboundHealth({
			lastReceivedAt: latest?.updatedAt ?? null,
			lastScriptVersion: latest?.scriptVersion ?? null,
			now: new Date()
		}),
		recent: recentRows.map((r) => ({
			id: r.id,
			label: r.label,
			from: r.fromAddress,
			subject: r.subject,
			status: r.status,
			ruleNames: r.rules.map((rule) => rule.ruleName),
			error: r.error,
			attempts: r.attempts,
			at: r.updatedAt.toISOString()
		}))
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
		emailInbound,
		people
	};
};
