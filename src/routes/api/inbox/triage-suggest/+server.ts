import { json } from '@sveltejs/kit';
import { openai } from '$lib/server/openai';
import { listInboxItems } from '$lib/server/inbox';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

interface ItemSuggestion {
	id: string;
	estimateMinutes?: number;
	themeId?: string | null;
	breakdown?: string[];
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => ({}));
	const itemIdsFilter: string[] | null = Array.isArray(body?.itemIds) ? body.itemIds : null;

	const allItems = await listInboxItems(locals.userId);
	const items = itemIdsFilter ? allItems.filter((i) => itemIdsFilter.includes(i.id)) : allItems;
	if (items.length === 0) return json({ suggestions: [] });

	const userThemes = await db.query.themes.findMany({
		where: and(eq(themes.userId, locals.userId), eq(themes.archived, false)),
		columns: { id: true, name: true, parentTheme: true }
	});

	const themesList = userThemes.length
		? userThemes
				.map((t) => `- ${t.id}: ${t.name}${t.parentTheme ? ` (${t.parentTheme})` : ''}`)
				.join('\n')
		: '(brukeren har ingen temaer enda)';

	const itemsList = items.map((i, idx) => `${idx + 1}. id=${i.id}: ${i.text}`).join('\n');

	const systemPrompt = `Du hjelper brukeren sortere oppgaver i en innboks. For hver oppgave skal du foreslå:
1. estimateMinutes: realistisk tid i minutter (15 = kvarter, 30 = halv time, 60 = time, 240 = halv arbeidsdag, 480 = full arbeidsdag, 1440 = en dag, 2880+ = flere dager)
2. themeId: id-en til ett av brukerens temaer hvis oppgaven naturlig hører hjemme der — ellers null
3. breakdown: 2–5 delsteg HVIS oppgaven er kompleks nok (typisk > 60 min). Ellers utelat feltet eller bruk tom liste.

Returner KUN gyldig JSON i dette formatet, ingen prosa:
{"suggestions":[{"id":"<id>","estimateMinutes":<tall>,"themeId":"<uuid>|null","breakdown":["steg 1","steg 2"]}]}

Brukerens temaer:
${themesList}

Oppgavene:
${itemsList}`;

	let suggestions: ItemSuggestion[] = [];
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [{ role: 'system', content: systemPrompt }],
			response_format: { type: 'json_object' },
			temperature: 0.3
		});
		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content);
		const validIds = new Set(items.map((i) => i.id));
		const validThemeIds = new Set(userThemes.map((t) => t.id));
		suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
			.filter((s: unknown): s is { id: string } & Record<string, unknown> =>
				!!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string'
			)
			.filter((s: { id: string }) => validIds.has(s.id))
			.map((s: { id: string } & Record<string, unknown>) => {
				const result: ItemSuggestion = { id: s.id };
				if (typeof s.estimateMinutes === 'number' && s.estimateMinutes > 0 && s.estimateMinutes < 100000) {
					result.estimateMinutes = Math.round(s.estimateMinutes);
				}
				if (typeof s.themeId === 'string' && validThemeIds.has(s.themeId)) {
					result.themeId = s.themeId;
				} else if (s.themeId === null) {
					result.themeId = null;
				}
				if (Array.isArray(s.breakdown)) {
					const clean = s.breakdown
						.filter((t: unknown): t is string => typeof t === 'string')
						.map((t: string) => t.trim())
						.filter((t: string) => t.length > 0 && t.length < 240)
						.slice(0, 8);
					if (clean.length > 0) result.breakdown = clean;
				}
				return result;
			});
	} catch (err) {
		console.error('[inbox/triage-suggest] failed', err);
		return json({ error: 'Kunne ikke hente forslag akkurat nå' }, { status: 500 });
	}

	return json({ suggestions });
};
