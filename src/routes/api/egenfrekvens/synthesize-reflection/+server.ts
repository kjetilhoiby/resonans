import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { openai } from '$lib/server/openai';

const MIN_USER_WORDS_FOR_SYNTHESIS = 12;

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const eventId = body?.eventId;
	if (!eventId) return json({ error: 'Mangler eventId' }, { status: 400 });

	const event = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, eventId),
			eq(sensorEvents.userId, locals.userId),
			eq(sensorEvents.dataType, 'egenfrekvens_checkin')
		)
	});

	if (!event) return json({ error: 'Ikke funnet' }, { status: 404 });

	const data = (event.data ?? {}) as Record<string, unknown>;
	const thread = data.reflectionThread as Array<{ role: string; text: string }> | undefined;
	const a = data.actions;
	const f = data.feelings;
	const t = data.thoughts;
	const b = data.balance;
	const reasons = data.reasons as Record<string, string[]> | undefined;
	const noteText = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null;

	const userMessages = (thread ?? [])
		.filter((m) => m.role === 'user')
		.map((m) => (typeof m.text === 'string' ? m.text.trim() : ''))
		.filter((s): s is string => s.length > 0);

	const userWordCount = [noteText ?? '', ...userMessages]
		.join(' ')
		.split(/\s+/)
		.filter(Boolean).length;

	const existingReflection = typeof data.reflection === 'string' ? data.reflection : '';
	const stateLine = existingReflection.split('\n')[0] ?? '';

	// Hvis brukeren har sagt for lite, hopp over syntese — dashboardet faller tilbake til rå-chat.
	const hasEnoughUserContent =
		userMessages.length >= 1 || userWordCount >= MIN_USER_WORDS_FOR_SYNTHESIS;

	if (!hasEnoughUserContent) {
		await db
			.update(sensorEvents)
			.set({
				data: {
					...data,
					reflection: stateLine,
					reflectionSynthesis: null
				}
			})
			.where(eq(sensorEvents.id, eventId));
		return json({ ok: true, synthesis: null, fallback: 'raw' });
	}

	// Bygg strukturert user-content som inkluderer hele chatten med tydelige rolle-tags.
	// Syntese-prompten skiller eksplisitt mellom det brukeren har sagt (kilde til "du gir
	// uttrykk for...") og AI-ens meldinger (kontekst, men aldri tilskrevet brukeren).
	const userContent: string[] = [];
	userContent.push('# SJEKKIN');
	userContent.push(`Tall: handlinger ${a}/5, følelser ${f}/5, tanker ${t}/5 (balanse ${b}).`);
	if (reasons) {
		for (const [dim, vals] of Object.entries(reasons)) {
			if (vals.length) userContent.push(`Brukerens valgte signaler (${dim}): ${vals.join(', ')}`);
		}
	}
	if (noteText) {
		userContent.push('');
		userContent.push(`<BRUKERS_INNSATS_NOTAT>${noteText}</BRUKERS_INNSATS_NOTAT>`);
	}

	if (thread && thread.length > 0) {
		userContent.push('');
		userContent.push('# REFLEKSJONSCHAT');
		userContent.push(
			'Hver melding er merket med <BRUKER> eller <AI>. KUN <BRUKER>-meldinger og <BRUKERS_INNSATS_NOTAT> over kan brukes som kilde til hva brukeren mener, har bestemt eller føler. <AI>-meldinger er kontekst — de er forslag og spørsmål, ikke brukerens posisjon.'
		);
		for (const msg of thread) {
			const text = typeof msg.text === 'string' ? msg.text.trim() : '';
			if (!text) continue;
			if (msg.role === 'user') {
				userContent.push(`<BRUKER>${text}</BRUKER>`);
			} else if (msg.role === 'assistant') {
				userContent.push(`<AI>${text}</AI>`);
			}
		}
	}

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: [
					'Du oppsummerer en egenfrekvens-sjekkin og påfølgende refleksjonschat.',
					'Skriv i andre person, varsom observerende stil: "Du gir uttrykk for...", "Du beskriver...", "Du peker på...".',
					'Maks 2-3 setninger på norsk.',
					'',
					'KILDEREGLER (kritiske):',
					'- Innholdet i <BRUKER>...</BRUKER> og <BRUKERS_INNSATS_NOTAT>...</BRUKERS_INNSATS_NOTAT>, samt tall og valgte signaler, er det ENESTE som kan tilskrives brukeren.',
					'- Innholdet i <AI>...</AI> er IKKE brukerens posisjon. AI-ens forslag, hypoteser og spørsmål skal aldri gjengis som om brukeren har bestemt seg for dem eller mener dem — selv om de virker plausible.',
					'- En idé fra AI teller som "brukerens" KUN hvis brukeren eksplisitt bekrefter den i en <BRUKER>-melding ("ja, det skal jeg", "det stemmer", "akkurat").',
					'- Ikke dikt opp beslutninger, planer eller intensjoner.',
					'- Ikke gi råd. Ikke tolk videre enn det brukeren faktisk har sagt.',
					'- Hvis brukeren har sagt lite, hold deg til tallene, signalene og notatet.'
				].join('\n')
			},
			{ role: 'user', content: userContent.join('\n') }
		],
		temperature: 0.15,
		max_tokens: 250
	});

	const synthesis = completion.choices[0]?.message?.content?.trim() ?? '';
	if (!synthesis) return json({ error: 'Tom syntese' }, { status: 500 });

	await db
		.update(sensorEvents)
		.set({
			data: {
				...data,
				reflection: `${stateLine}\n${synthesis}`,
				reflectionSynthesis: synthesis
			}
		})
		.where(eq(sensorEvents.id, eventId));

	return json({ ok: true, synthesis });
};
