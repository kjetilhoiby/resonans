import { redirect } from '@sveltejs/kit';
import { getConversationByIdForUser, getConversationMessagesPage, getConversationMessagesFromDate, getOrCreateCanonicalConversation, getUserConversationList } from '$lib/server/conversations';
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

// Antall meldinger som lastes ved første åpning av en tråd. Resten hentes ved
// infinite scroll oppover (se /api/conversations/[id]/messages?before=…&limit=…).
const INITIAL_MESSAGE_BUFFER = 12;

export const load: PageServerLoad = async ({ locals, url }) => {
	const t0 = performance.now();
	let conversationId = url.searchParams.get('conversation');
	const contextParam = url.searchParams.get('context');
	const canonicalParam = url.searchParams.get('canonical');
	const dateParam = url.searchParams.get('date');
	const isValidDate = !!dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

	// ?canonical=1 (typisk fra ukeplanen) løser opp den kanoniske «dagbok»-tråden.
	if (!conversationId && canonicalParam === '1' && contextParam !== 'weight') {
		const canonical = await getOrCreateCanonicalConversation(locals.userId);
		conversationId = canonical.id;
	}

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
		console.log(`[perf][samtaler] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} mode=weight convs=${conversations.length}`);
		return {
			conversations,
			userThemes,
			selectedConversation: null,
			messages: [],
			hasMoreMessages: false,
			scrollToDate: null,
			weightContext
		};
	}

	if (!conversationId) {
		console.log(`[perf][samtaler] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} mode=list convs=${conversations.length}`);
		return { conversations, userThemes, selectedConversation: null, messages: [], hasMoreMessages: false, scrollToDate: null, weightContext: null };
	}

	const verifiedConversation = await getConversationByIdForUser(conversationId, locals.userId);
	if (!verifiedConversation) {
		throw redirect(302, '/samtaler');
	}

	const selectedConversation = conversations.find((c) => c.id === conversationId) ?? null;

	// Hopp-til-dag (fra ukeplanen): last dagen og alt etter, slik at klienten kan scrolle
	// til dag-ankeret. Buffer én dag bakover for å være robust mot tidssone-grenser.
	// Faller tilbake til vanlig «nyeste»-lasting hvis dagen (og alt etter) er tom.
	let msgs;
	let hasMore: boolean;
	let scrollToDate: string | null = null;
	if (isValidDate) {
		const from = new Date(dateParam + 'T00:00:00Z');
		from.setUTCDate(from.getUTCDate() - 1);
		const windowed = await getConversationMessagesFromDate(conversationId, from);
		if (windowed.messages.length > 0) {
			msgs = windowed.messages;
			hasMore = windowed.hasMoreOlder;
			scrollToDate = dateParam;
		} else {
			const page = await getConversationMessagesPage(conversationId, { limit: INITIAL_MESSAGE_BUFFER });
			msgs = page.messages;
			hasMore = page.hasMore;
		}
	} else {
		const page = await getConversationMessagesPage(conversationId, { limit: INITIAL_MESSAGE_BUFFER });
		msgs = page.messages;
		hasMore = page.hasMore;
	}

	console.log(`[perf][samtaler] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} mode=conversation convs=${conversations.length} msgs=${msgs.length} hasMore=${hasMore} jump=${scrollToDate ?? 'none'}`);

	return {
		conversations,
		userThemes,
		selectedConversation,
		weightContext: null,
		hasMoreMessages: hasMore,
		scrollToDate,
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
			photoAnnotationImageUrl: (m.metadata as { photoAnnotationImageUrl?: unknown } | null)?.photoAnnotationImageUrl ?? null,
			eventCard: (m.metadata as { eventCard?: unknown } | null)?.eventCard ?? null
		}))
	};
};
