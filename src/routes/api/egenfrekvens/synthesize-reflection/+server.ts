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

	// Bygg user-content som KUN inneholder ting brukeren selv har skrevet/valgt.
	// AI-ens meldinger fra refleksjonschatten skal aldri være kilde til hva brukeren har uttrykt.
	const userContent: string[] = [];
	userContent.push(`Tall: handlinger ${a}/5, følelser ${f}/5, tanker ${t}/5 (balanse ${b}).`);
	if (reasons) {
		for (const [dim, vals] of Object.entries(reasons)) {
			if (vals.length) userContent.push(`Valgte signaler (${dim}): ${vals.join(', ')}`);
		}
	}
	if (noteText) userContent.push(`Innsats-sitat fra bruker: "${noteText}"`);
	if (userMessages.length) {
		userContent.push('');
		userContent.push(
			'Brukerens meldinger i refleksjonschatten (BRUK KUN DISSE som kilde til hva brukeren har uttrykt):'
		);
		for (const msg of userMessages) userContent.push(`- "${msg}"`);
	}

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: [
					'Du oppsummerer hva BRUKEREN selv har uttrykt i en egenfrekvens-sjekkin.',
					'Skriv i andre person, varsom observerende stil: "Du gir uttrykk for...", "Du beskriver...", "Du peker på...".',
					'Maks 2-3 setninger på norsk.',
					'',
					'STRENGE regler:',
					'- Bruk KUN det brukeren selv har skrevet eller valgt. Du har IKKE tilgang til AI-ens meldinger eller spørsmål, og må aldri gjengi forslag, hypoteser eller tolkninger som om brukeren har bekreftet dem.',
					'- Ikke dikt opp beslutninger, planer eller intensjoner brukeren ikke har sagt eksplisitt.',
					'- Ikke gi råd. Ikke tolk videre enn ordene tilsier.',
					'- Hvis brukeren har sagt lite, hold deg til tallene, signalene og note-sitatet.'
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
