import { json } from '@sveltejs/kit';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';
import { MemoryService } from '$lib/server/services/memory-service';
import { addCanonicalEventMessage } from '$lib/server/conversations';
import { buildLivsintervjuMarkdown, parseValueLines } from '$lib/flows/livsintervju';
import type { RequestHandler } from './$types';

/**
 * Lagrer livsintervjuet: visjonene som brukerforfattede dreams (én per
 * horisont, superseder forrige), verdiene som user_confirmed memories,
 * destillatet som refleksjon per år (kind 'livsintervju', upsert) og
 * chattene som transkript-refleksjon ('livsintervju_chat' — «samtalen er
 * data»). Skriver til slutt et hendelseskort i dagboken.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const verdier = typeof body?.verdier === 'string' ? body.verdier.trim() : '';
	const rawVisions = (body?.visions ?? {}) as { ettAar?: unknown; femAar?: unknown; tiAar?: unknown };
	const ettAar = typeof rawVisions.ettAar === 'string' ? rawVisions.ettAar.trim() : '';
	const femAar = typeof rawVisions.femAar === 'string' ? rawVisions.femAar.trim() : '';
	const tiAar = typeof rawVisions.tiAar === 'string' ? rawVisions.tiAar.trim() : '';
	const speil = typeof body?.speil === 'string' ? body.speil.trim() : '';

	if (!verdier && !ettAar && !femAar && !tiAar) {
		return json({ error: 'Tomt intervju' }, { status: 400 });
	}

	// Destillatet: én refleksjon per år, stabile overskrifter for neste års re-intervju
	const periodKey = String(new Date().getFullYear());
	const content = buildLivsintervjuMarkdown({
		verdier,
		ti_aar: tiAar,
		fem_aar: femAar,
		ett_aar: ettAar,
		speil
	});
	const reflection = await upsertReflectionForPeriod({
		userId,
		kind: 'livsintervju',
		periodKey,
		content
	});

	// Visjonene: brukerforfattet, user_confirmed — superseder forrige per horisont
	const savedVisions: string[] = [];
	if (tiAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_10year', summary: tiAar });
		savedVisions.push('vision_10year');
	}
	if (femAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_5year', summary: femAar });
		savedVisions.push('vision_5year');
	}
	if (ettAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_yearly', summary: ettAar });
		savedVisions.push('vision_yearly');
	}

	// Verdiene: kuraterte memories i brukerens egne ord, dedup/supersede via accept
	let valuesCreated = 0;
	for (const line of parseValueLines(verdier)) {
		const created = await MemoryService.accept(
			userId,
			{
				content: line,
				category: 'values',
				importance: 'high',
				sourceRef: reflection ? { kind: 'reflection', id: reflection.id } : undefined
			},
			{ confidence: 'user_confirmed' }
		);
		if (created) valuesCreated++;
	}

	// Chattene arkiveres som egen refleksjon — destillatet bor i 'livsintervju'
	const threads = body?.threads as
		| { verdier?: unknown; tiAar?: unknown; femAar?: unknown; ettAar?: unknown; speil?: unknown }
		| undefined;
	const transcriptParts: string[] = [];
	const threadSections: Array<[string, unknown]> = [
		['Verdiene mine', threads?.verdier],
		['Om ti år', threads?.tiAar],
		['Om fem år', threads?.femAar],
		['Om ett år', threads?.ettAar],
		['Speilet', threads?.speil]
	];
	for (const [heading, thread] of threadSections) {
		if (typeof thread === 'string' && thread.trim()) {
			transcriptParts.push(`## ${heading}\n${thread.trim()}`);
		}
	}
	if (transcriptParts.length > 0) {
		await upsertReflectionForPeriod({
			userId,
			kind: 'livsintervju_chat',
			periodKey,
			content: transcriptParts.join('\n\n')
		});
	}

	// Fire-and-forget: hendelseskort i dagboken
	void addCanonicalEventMessage(userId, {
		kind: 'flow',
		icon: '🧭',
		title: 'Livsintervjuet levert — retningen er oppdatert',
		href: '/drommer'
	}).catch((err) => console.error('[retning] event-kort feilet:', err));

	return json({
		ok: true,
		id: reflection?.id ?? null,
		periodKey,
		savedVisions,
		valuesCreated
	});
};
