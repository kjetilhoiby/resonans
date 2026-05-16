import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { procedures, users } from '$lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { findSimilar } from '$lib/server/similarity';
import { openai } from '$lib/server/openai';

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	const { taskTitle, domain } = body as { taskTitle: string; domain?: string };

	if (!taskTitle) return json({ error: 'taskTitle er påkrevd' }, { status: 400 });

	const conditions = [eq(procedures.userId, userId), isNull(procedures.archivedAt)];
	if (domain) conditions.push(eq(procedures.domain, domain));

	let allProcedures = await db.query.procedures.findMany({
		where: and(...conditions),
		columns: { id: true, title: true, emoji: true, triggerKeywords: true, domain: true }
	});

	const [user] = await db
		.select({ partnerUserId: users.partnerUserId })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (user?.partnerUserId) {
		const partnerConditions = [
			eq(procedures.userId, user.partnerUserId),
			eq(procedures.shared, true),
			isNull(procedures.archivedAt)
		];
		if (domain) partnerConditions.push(eq(procedures.domain, domain));

		const partnerProcedures = await db.query.procedures.findMany({
			where: and(...partnerConditions),
			columns: { id: true, title: true, emoji: true, triggerKeywords: true, domain: true }
		});
		allProcedures = [...allProcedures, ...partnerProcedures];
	}

	if (allProcedures.length === 0) return json({ matches: [] });

	const titleWords = taskTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
	const keywordMatches = allProcedures
		.map(p => {
			const overlap = p.triggerKeywords.filter(kw => titleWords.some(w => kw.toLowerCase().includes(w) || w.includes(kw.toLowerCase())));
			return { ...p, overlap: overlap.length, matchType: 'keyword' as const };
		})
		.filter(p => p.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap);

	if (keywordMatches.length > 0) {
		return json({
			matches: keywordMatches.slice(0, 3).map(m => ({
				procedureId: m.id,
				title: m.title,
				emoji: m.emoji,
				similarity: (m.overlap / Math.max(titleWords.length, 1)) * 100,
				matchType: m.matchType
			}))
		});
	}

	const titleMatches = findSimilar(
		taskTitle,
		allProcedures,
		p => p.title,
		55
	);

	if (titleMatches.length > 0) {
		return json({
			matches: titleMatches.slice(0, 3).map(m => ({
				procedureId: m.item.id,
				title: m.item.title,
				emoji: m.item.emoji,
				similarity: m.similarity,
				matchType: 'title' as const
			}))
		});
	}

	if (allProcedures.length <= 50) {
		try {
			const procedureList = allProcedures.map(p => `${p.id}: ${p.title}`).join('\n');
			const response = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				temperature: 0,
				max_tokens: 100,
				messages: [{
					role: 'system',
					content: 'Du matcher oppgavetitler mot eksisterende fremgangsmåter. Svar med ID-en til den mest relevante fremgangsmåten, eller "null" hvis ingen passer. Svar KUN med ID eller null.'
				}, {
					role: 'user',
					content: `Oppgave: "${taskTitle}"\n\nTilgjengelige fremgangsmåter:\n${procedureList}`
				}]
			});

			const answer = response.choices[0]?.message?.content?.trim();
			if (answer && answer !== 'null') {
				const matched = allProcedures.find(p => p.id === answer);
				if (matched) {
					return json({
						matches: [{
							procedureId: matched.id,
							title: matched.title,
							emoji: matched.emoji,
							similarity: 80,
							matchType: 'semantic' as const
						}]
					});
				}
			}
		} catch (e) {
			console.warn('Procedure semantic matching failed:', e);
		}
	}

	return json({ matches: [] });
};
