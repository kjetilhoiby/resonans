import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { memories, reflections } from '$lib/db/schema';
import { DreamService, type VisionHorizon } from '$lib/server/services/dream-service';
import { getLatestReflection } from '$lib/server/reflections';
import { getLivskompassRecent, getLivskompassStatus } from '$lib/server/livskompass-checkin';
import { listDeprioritizations } from '$lib/server/livskompass-deprioritization';
import { readRanking } from '$lib/server/livskompass-ranking';
import { describeLivskompassMaterial } from '$lib/domains/livskompass/interview-material';
import { describeRanking } from '$lib/domains/livskompass/ranking';
import type { RequestHandler } from './$types';

/** Hvor mange ukesinnsjekker intervjuet ser bakover. To måneder er et mønster. */
const LIVSKOMPASS_WEEKS = 8;

const HORIZON_LABELS: Record<VisionHorizon, string> = {
	vision_10year: 'Om ti år',
	vision_5year: 'Om fem år',
	vision_yearly: 'Om ett år',
	vision_quarterly: 'Kommende kvartal'
};

/**
 * Kontekst til livsintervjuet: eksisterende retning (aktive visjoner),
 * lagrede verdier, forrige intervju-destillat — og fra september 2026
 * livskompasset som DATA.
 *
 * Det siste er forskjellen intervjuet manglet. Fram til da fikk promptene
 * livskompasset som en statisk ordliste, altså tolv etiketter en modell kunne
 * funnet på selv. «Venner har ligget ute av synk i sju av åtte uker» kan den
 * ikke — og den observasjonen er det et tiårsspørsmål skal møtes med.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	const horizons = Object.keys(HORIZON_LABELS) as VisionHorizon[];
	const [
		visions,
		valueMemories,
		forrigeIntervju,
		weeklyDream,
		monthlyDream,
		kilde,
		ukesinnsjekker,
		nedprioriteringer,
		rangering,
		status
	] = await Promise.all([
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
		DreamService.getActive(userId, 'monthly_dream'),
		// Balanse-materialet — full tekst; trimming for prompt skjer i buildPrompts
		getLatestReflection(userId, 'livsintervju_kilde'),
		// Livskompasset som data: åtte uker med målinger, ikke en ordliste
		getLivskompassRecent(userId, LIVSKOMPASS_WEEKS),
		// Et valgt gap skal ikke konfronteres som drift — heller ikke her
		listDeprioritizations(userId),
		// Rekkefølgen fra forrige gang: den skal testes, ikke skrives på nytt blindt
		readRanking(userId),
		// Viktighetsprofilen er eneste kilde når ingen uker er målt
		getLivskompassStatus(userId)
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

	const livskompass = describeLivskompassMaterial({
		weeks: ukesinnsjekker.map((c) => ({ week: c.week, scores: c.scores })),
		deprioritizations: nedprioriteringer,
		importance: status.prefillImportance
	});

	return json({
		eksisterendeRetning: retningLines.join('\n'),
		livskompass,
		rangeringNaa: rangering ? describeRanking(rangering) : '',
		verdierNaa: valueMemories.map((m) => `- ${m.content}`).join('\n'),
		forrigeIntervju: forrigeIntervju?.content ?? '',
		synteser: synteseLines.join('\n'),
		kildemateriale: kilde?.content ?? ''
	});
};
