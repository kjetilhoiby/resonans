import { json } from '@sveltejs/kit';
import { createReflection, upsertReflectionForPeriod } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';
import { MemoryService } from '$lib/server/services/memory-service';
import { addCanonicalEventMessage, getConversationByIdForUser } from '$lib/server/conversations';
import { buildLivsintervjuMarkdown, parseValueLines, type LongTermGoal } from '$lib/flows/livsintervju';
import { createLongTermGoal } from '$lib/server/retning-goals';
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
	const kilde = typeof body?.kilde === 'string' ? body.kilde.trim() : '';

	if (!verdier && !ettAar && !femAar && !tiAar && !kilde) {
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

	// Chattene arkiveres append-only («samtalen er data» — et re-intervju skal
	// aldri slette forrige samtale). Lagres FØR visjonene så de kan refereres.
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
	let transcript: Awaited<ReturnType<typeof createReflection>> = null;
	if (transcriptParts.length > 0) {
		transcript = await createReflection({
			userId,
			kind: 'livsintervju_chat',
			periodKey,
			content: transcriptParts.join('\n\n')
		});
	}

	// Balanse-materialet: rått innlimt kildemateriale i originalformat, append-only
	let kildeReflection: Awaited<ReturnType<typeof createReflection>> = null;
	if (kilde) {
		kildeReflection = await createReflection({
			userId,
			kind: 'livsintervju_kilde',
			periodKey,
			content: kilde
		});
	}

	// Rå-samtalen i messages-tabellen — valideres før den kobles til visjonene
	const rawConversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	let conversationId: string | null = null;
	if (rawConversationId) {
		const conversation = await getConversationByIdForUser(rawConversationId, userId);
		conversationId = conversation?.id ?? null;
	}

	// Kildekobling: hver visjon peker tilbake til destillat, transkript, kildemateriale og samtale
	const inputRefs = {
		reflectionIds: [reflection?.id, transcript?.id, kildeReflection?.id].filter(
			(id): id is string => Boolean(id)
		),
		conversationIds: conversationId ? [conversationId] : undefined
	};

	// Visjonene: brukerforfattet, user_confirmed — superseder forrige per horisont
	const savedVisions: string[] = [];
	if (tiAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_10year', summary: tiAar, inputRefs });
		savedVisions.push('vision_10year');
	}
	if (femAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_5year', summary: femAar, inputRefs });
		savedVisions.push('vision_5year');
	}
	if (ettAar) {
		await DreamService.saveAuthoredVision(userId, { horizon: 'vision_yearly', summary: ettAar, inputRefs });
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

	// Speilets målbare langtidsmål → goals med visionHorizon (dedup i helperen)
	const rawLongTermGoals = Array.isArray(body?.langtidsmaal)
		? (body.langtidsmaal as LongTermGoal[])
		: [];
	let goalsCreated = 0;
	for (const goal of rawLongTermGoals.slice(0, 5)) {
		try {
			const created = await createLongTermGoal(userId, goal);
			if (created) goalsCreated++;
		} catch (err) {
			console.error('[retning] langtidsmål feilet:', err);
		}
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
		valuesCreated,
		goalsCreated
	});
};
