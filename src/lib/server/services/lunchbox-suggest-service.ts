/**
 * lunchbox-suggest-service.ts — foreslår NYE matpakke-komponenter for familien
 * med AI, basert på barnas preferanser, biblioteket de allerede har, og hva som
 * ofte kommer i retur. Lagrer ingenting; klienten legger valgte forslag til via
 * det vanlige components-endepunktet.
 *
 * Formålet er å utvide repertoaret når det samme går igjen (og kommer i retur).
 */

import { db } from '$lib/db';
import { lunchboxComponents, lunchboxProfiles, lunchboxReturns, persons } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { osloTodayIso, addDaysIso } from '$lib/server/iso-week';
import { KIND_META, type ComponentKind } from '$lib/domains/food/lunchbox';
import {
	normalizeComponentSuggestions,
	type SuggestedComponent
} from '$lib/domains/food/lunchbox-component-suggestion';

export type { SuggestedComponent };

export type LunchboxSuggestInput = {
	kind?: ComponentKind | null;
	instruction?: string | null;
	limit?: number;
};

export type LunchboxSuggestResult =
	| { ok: true; suggestions: SuggestedComponent[] }
	| { ok: false; error: string; status: number };

export async function suggestLunchboxComponents(
	userId: string,
	input: LunchboxSuggestInput
): Promise<LunchboxSuggestResult> {
	// Biblioteket (alle, også inaktive) — vi vil ikke foreslå noe de har fra før.
	const existing = await db
		.select({ name: lunchboxComponents.name })
		.from(lunchboxComponents)
		.where(eq(lunchboxComponents.userId, userId));
	const existingNames = existing.map((c) => c.name);

	// Barnas preferanser
	const children = await db
		.select({ id: persons.id })
		.from(persons)
		.where(and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false)));

	const profiles = children.length
		? await db
				.select({
					likes: lunchboxProfiles.likes,
					dislikes: lunchboxProfiles.dislikes,
					allergies: lunchboxProfiles.allergies
				})
				.from(lunchboxProfiles)
				.where(eq(lunchboxProfiles.userId, userId))
		: [];

	const likes = [...new Set(profiles.flatMap((p) => p.likes))];
	const dislikes = [...new Set(profiles.flatMap((p) => p.dislikes))];
	const allergies = [...new Set(profiles.flatMap((p) => p.allergies))];

	// Hva kommer ofte i retur? (siste 30 dager) — grunn til å foreslå variasjon.
	const since = addDaysIso(osloTodayIso(), -30);
	const returns = await db
		.select({ itemName: lunchboxReturns.itemName })
		.from(lunchboxReturns)
		.where(and(eq(lunchboxReturns.userId, userId), gte(lunchboxReturns.date, since)))
		.orderBy(desc(lunchboxReturns.date))
		.limit(40);
	const returnedOften = [...new Set(returns.map((r) => r.itemName))].slice(0, 12);

	const kindKeys = (Object.keys(KIND_META) as ComponentKind[]).join(', ');
	const kindFocus = input.kind
		? `\nFokusér KUN på kategorien «${input.kind}» (${KIND_META[input.kind].label}).`
		: '';

	const systemPrompt = `Du foreslår NYE matpakke-elementer for en norsk familie med barn (fem matpakker daglig). Returner KUN gyldig JSON:
{ "suggestions": [ { "name": "kort norsk navn", "kind": "en av [${kindKeys}]", "tags": ["valgfritt"], "reason": "én kort setning" } ] }
Regler:
- Foreslå 6–10 elementer familien IKKE allerede har.
- ALDRI foreslå noe som inneholder allergener (harde krav).
- Len deg mot det barna liker; unngå det de misliker.
- Hvis noe ofte kommer i retur, foreslå gjerne variasjon eller alternativer til det.
- Hverdagsvennlige norske dagligvarer som er lette å få tak i (også på Oda).
- Hold navnene korte og konkrete (f.eks. «Kaviar», «Cashewnøtter», «Cherrytomater»).${kindFocus}`;

	const userContent = [
		existingNames.length ? `Har allerede: ${existingNames.join(', ')}` : 'Biblioteket er tomt.',
		likes.length ? `Barna liker: ${likes.join(', ')}` : '',
		dislikes.length ? `Barna liker ikke: ${dislikes.join(', ')}` : '',
		allergies.length ? `ALLERGIER (må unngås): ${allergies.join(', ')}` : '',
		returnedOften.length ? `Kommer ofte i retur: ${returnedOften.join(', ')}` : '',
		input.instruction?.trim() ? `Ønske: ${input.instruction.trim()}` : ''
	]
		.filter(Boolean)
		.join('\n');

	let completion;
	try {
		completion = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userContent || 'Foreslå et variert utvalg matpakke-elementer.' }
			],
			response_format: { type: 'json_object' },
			temperature: 0.7,
			max_tokens: 1200
		});
	} catch {
		return { ok: false, error: 'AI-forslaget feilet. Prøv igjen.', status: 502 };
	}

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Klarte ikke tolke forslaget.', status: 502 };
	}

	const suggestions = normalizeComponentSuggestions(parsed, {
		existingNames,
		avoid: allergies,
		kind: input.kind ?? null,
		limit: input.limit ?? 10
	});

	return { ok: true, suggestions };
}
