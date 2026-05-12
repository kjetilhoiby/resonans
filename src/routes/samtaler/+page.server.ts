import { redirect } from '@sveltejs/kit';
import { getConversationByIdForUser, getConversationMessages, getUserConversationList } from '$lib/server/conversations';
import { db } from '$lib/db';
import { themes, sensorEvents, goals } from '$lib/db/schema';
import { eq, and, gte, desc, or, ilike } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

async function buildWeightContext(userId: string): Promise<string | null> {
	const threeMonthsAgo = new Date();
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	const [weightEvents, weightGoals, healthTheme] = await Promise.all([
		db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, threeMonthsAgo)
			),
			orderBy: (se, { asc }) => [asc(se.timestamp)]
		}),
		db.query.goals.findMany({
			where: and(
				eq(goals.userId, userId),
				eq(goals.status, 'active'),
				or(
					ilike(goals.title, '%vekt%'),
					ilike(goals.title, '%weight%'),
					ilike(goals.title, '%kilo%'),
					ilike(goals.title, '%kg%')
				)
			)
		}),
		db.query.themes.findFirst({
			where: and(eq(themes.userId, userId), eq(themes.name, 'Helse')),
			columns: { metricSettings: true }
		})
	]);

	const validWeights = weightEvents
		.map((e) => {
			const d = e.data as Record<string, unknown>;
			const w = d?.weight as number | undefined;
			return w && w > 0 ? { date: e.timestamp, weight: w } : null;
		})
		.filter(Boolean) as { date: Date; weight: number }[];

	if (validWeights.length === 0) return null;

	const latest = validWeights[validWeights.length - 1];
	const oldest = validWeights[0];
	const change = latest.weight - oldest.weight;
	const weights = validWeights.map((w) => w.weight);
	const min = Math.min(...weights);
	const max = Math.max(...weights);

	const fmt = (d: Date) =>
		d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });

	const lines: string[] = [
		'## Vektkontekst',
		'',
		`Siste veiing: ${latest.weight.toFixed(1)} kg (${fmt(latest.date)})`,
		`Antall veiinger siste 3 mnd: ${validWeights.length}`,
		`Endring siste 3 mnd: ${change >= 0 ? '+' : ''}${change.toFixed(1)} kg (${oldest.weight.toFixed(1)} → ${latest.weight.toFixed(1)})`,
		`Min/maks: ${min.toFixed(1)} – ${max.toFixed(1)} kg`
	];

	const metricSettings = healthTheme?.metricSettings as { weight?: { goal?: number } } | null;
	if (metricSettings?.weight?.goal) {
		const goal = metricSettings.weight.goal;
		const diff = latest.weight - goal;
		lines.push(`Vektmål (helsetema): ${goal.toFixed(1)} kg (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} fra mål)`);
	}

	if (weightGoals.length > 0) {
		lines.push('', 'Aktive mål:');
		for (const g of weightGoals) {
			const meta = g.metadata as Record<string, unknown> | null;
			const target = meta?.targetWeight as number | undefined;
			const goalLine = target
				? `- ${g.title} (mål: ${target} kg)`
				: `- ${g.title}`;
			lines.push(goalLine);
			if (g.description) lines.push(`  ${g.description}`);
		}
	}

	const recent = validWeights.slice(-10);
	if (recent.length > 1) {
		lines.push('', 'Siste veiinger:');
		for (const w of recent) {
			lines.push(`- ${fmt(w.date)}: ${w.weight.toFixed(1)} kg`);
		}
	}

	return lines.join('\n');
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const conversationId = url.searchParams.get('conversation');
	const contextParam = url.searchParams.get('context');

	const [conversationList, userThemes] = await Promise.all([
		getUserConversationList(locals.userId),
		db.query.themes.findMany({
			where: eq(themes.userId, locals.userId),
			columns: { id: true, name: true, emoji: true }
		})
	]);

	const conversations = conversationList.map((c) => ({
		...c,
		updatedAt: c.updatedAt.toISOString(),
		createdAt: c.createdAt.toISOString()
	}));

	if (contextParam === 'weight') {
		const weightContext = await buildWeightContext(locals.userId);
		return {
			conversations,
			userThemes,
			selectedConversation: null,
			messages: [],
			weightContext
		};
	}

	if (!conversationId) {
		return { conversations, userThemes, selectedConversation: null, messages: [], weightContext: null };
	}

	const verifiedConversation = await getConversationByIdForUser(conversationId, locals.userId);
	if (!verifiedConversation) {
		throw redirect(302, '/samtaler');
	}

	const selectedConversation = conversations.find((c) => c.id === conversationId) ?? null;
	const msgs = await getConversationMessages(conversationId);

	return {
		conversations,
		userThemes,
		selectedConversation,
		weightContext: null,
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			starred: m.starred,
			timestamp: m.createdAt.toISOString(),
			imageUrl: m.imageUrl,
			widgetProposal: (m.metadata as { widgetProposal?: unknown } | null)?.widgetProposal ?? null,
			widgetFlow: (m.metadata as { widgetFlow?: unknown } | null)?.widgetFlow ?? null,
			statusWidget: (m.metadata as { statusWidget?: unknown } | null)?.statusWidget ?? null,
			photoAnnotation: (m.metadata as { photoAnnotation?: unknown } | null)?.photoAnnotation ?? null,
			photoAnnotationImageUrl: (m.metadata as { photoAnnotationImageUrl?: unknown } | null)?.photoAnnotationImageUrl ?? null
		}))
	};
};
