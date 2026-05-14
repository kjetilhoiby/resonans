import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { openai } from '$lib/server/openai';

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

	const contextLines = [
		`Handlinger: ${a}/5`,
		`Følelser: ${f}/5`,
		`Tanker: ${t}/5`,
		`Balanse: ${b}`,
	];
	if (reasons) {
		for (const [dim, vals] of Object.entries(reasons)) {
			if (vals.length) contextLines.push(`${dim}: ${vals.join(', ')}`);
		}
	}
	if (thread?.length) {
		contextLines.push('', 'REFLEKSJONSSAMTALE:');
		for (const msg of thread) {
			contextLines.push(`${msg.role === 'user' ? 'Bruker' : 'AI'}: ${msg.text}`);
		}
	}

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: [
					'Oppsummer denne egenfrekvens-sjekkinnen i 1-3 setninger på norsk.',
					'Skriv i tredjeperson observerende stil ("I dag ble...", "Følelsene preges av...").',
					'Inkluder det viktigste fra refleksjonssamtalen hvis den finnes.',
					'Ikke gi råd. Bare beskriv tilstanden og konteksten.',
					'Maks 150 ord.'
				].join(' ')
			},
			{ role: 'user', content: contextLines.join('\n') }
		],
		temperature: 0.3,
		max_tokens: 250
	});

	const synthesis = completion.choices[0]?.message?.content?.trim() ?? '';
	if (!synthesis) return json({ error: 'Tom syntese' }, { status: 500 });

	const existingReflection = typeof data.reflection === 'string' ? data.reflection : '';
	const stateLine = existingReflection.split('\n')[0] ?? '';

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
