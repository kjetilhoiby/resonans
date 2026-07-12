import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { memories, reflections } from '$lib/db/schema';
import { DreamService, type VisionHorizon } from '$lib/server/services/dream-service';
import type { RequestHandler } from './$types';

const HORIZON_LABELS: Record<VisionHorizon, string> = {
	vision_10year: 'Om ti år',
	vision_5year: 'Om fem år',
	vision_yearly: 'Om ett år',
	vision_quarterly: 'Kommende kvartal'
};

/**
 * Kontekst til livsintervjuet: eksisterende retning (aktive visjoner),
 * lagrede verdier og forrige intervju-destillat. Gjør at re-intervjuet kan
 * sitere det brukeren sa sist («sist sa du …, står det seg?»).
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	const horizons = Object.keys(HORIZON_LABELS) as VisionHorizon[];
	const [visions, valueMemories, forrigeIntervju, weeklyDream, monthlyDream] = await Promise.all([
		Promise.all(horizons.map((k) => DreamService.getActive(userId, k))),
		db.query.memories.findMany({
			where: and(
				eq(memories.userId, userId),
				eq(memories.category, 'values'),
				isNull(memories.supersededBy)
			),
			orderBy: [desc(memories.importance), desc(memories.createdAt)],
			limit: 10
		}),
		db.query.reflections.findFirst({
			where: and(eq(reflections.userId, userId), eq(reflections.kind, 'livsintervju')),
			orderBy: [desc(reflections.createdAt)]
		}),
		// Ferske synteser — brukes av retningssamtalen som «hva hverdagen faktisk viser»
		DreamService.getActive(userId, 'weekly_dream'),
		DreamService.getActive(userId, 'monthly_dream')
	]);

	const retningLines = visions
		.filter((v): v is NonNullable<typeof v> => Boolean(v?.summary))
		.map((v) => {
			const label = HORIZON_LABELS[v.kind as VisionHorizon] ?? v.kind;
			const suffix = v.originKind === 'user_authored' ? '' : ' (AI-utkast, ikke bekreftet)';
			return `[${label}]${suffix} ${v.summary}`;
		});

	const synteseLines = [
		monthlyDream?.summary ? `[Måneden som var] ${monthlyDream.summary}` : '',
		weeklyDream?.summary ? `[Uka som var] ${weeklyDream.summary}` : ''
	].filter(Boolean);

	return json({
		eksisterendeRetning: retningLines.join('\n'),
		verdierNaa: valueMemories.map((m) => `- ${m.content}`).join('\n'),
		forrigeIntervju: forrigeIntervju?.content ?? '',
		synteser: synteseLines.join('\n')
	});
};
