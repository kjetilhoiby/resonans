import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * Øktoppsummering for live teknikk-analyse (den «trege løkka»).
 *
 * Klienten kjører pose-analysen lokalt og sender KUN de utledede tallene hit —
 * aldri video eller bilder. GPT-4o gjør tallene om til kort, konkret coaching
 * på norsk i Resonans-coachens stemme.
 *
 * NB: ligger under /api/trening (autentisert) — locals.userId settes av hooken.
 */

const repSchema = z.object({
	index: z.number(),
	chinOverBar: z.boolean(),
	fullExtension: z.boolean(),
	peakElbowAngle: z.number(),
	bottomElbowAngle: z.number(),
	concentricMs: z.number(),
	eccentricMs: z.number()
});

const bodySchema = z.object({
	exercise: z.literal('pullups'),
	summary: z.object({
		reps: z.number(),
		chinOverBarReps: z.number(),
		fullExtensionReps: z.number(),
		cleanReps: z.number(),
		avgConcentricMs: z.number().nullable(),
		avgEccentricMs: z.number().nullable(),
		durationMs: z.number()
	}),
	reps: z.array(repSchema).max(200).optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Ikke autentisert' }, { status: 401 });
	}

	let parsed;
	try {
		parsed = bodySchema.parse(await request.json());
	} catch {
		return json({ error: 'Ugyldig data' }, { status: 400 });
	}

	const { summary } = parsed;
	if (summary.reps === 0) {
		return json({ coaching: 'Ingen reps registrert denne økta. Prøv igjen — pass på at hele kroppen er i bildet.' });
	}

	const facts = [
		`Antall reps: ${summary.reps}`,
		`Reps med hake over stang: ${summary.chinOverBarReps} av ${summary.reps}`,
		`Reps med full utstrekning i bunn: ${summary.fullExtensionReps} av ${summary.reps}`,
		`Rene reps (full ROM + hake over stang): ${summary.cleanReps} av ${summary.reps}`,
		summary.avgConcentricMs != null ? `Snitt opp-fase: ${(summary.avgConcentricMs / 1000).toFixed(1)} s` : null,
		summary.avgEccentricMs != null ? `Snitt ned-fase: ${(summary.avgEccentricMs / 1000).toFixed(1)} s` : null
	]
		.filter(Boolean)
		.join('\n');

	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o',
			max_tokens: 320,
			temperature: 0.6,
			messages: [
				{
					role: 'system',
					content: `Du er Resonans AI — en uformell, direkte treningscoach. Du gir tilbakemelding på en pull-up-økt basert på bevegelsesdata fra kameraet.

Stil:
- Norsk, kort og konkret. Maks 4-5 setninger.
- Start med det som var bra, så det viktigste å jobbe med.
- Vær presis: pek på ÉN hovedting å forbedre neste gang, knyttet til tallene.
- Ikke dikt opp tall som ikke står i dataene. Ikke bruk overskrifter eller punktlister — skriv som en coach som snakker.`
				},
				{
					role: 'user',
					content: `Her er dataene fra pull-up-økta:\n${facts}\n\nGi meg en kort oppsummering og det viktigste jeg bør jobbe med.`
				}
			]
		});

		const coaching = response.choices[0]?.message?.content?.trim() || 'Bra jobba! Fortsett sånn.';
		return json({ coaching });
	} catch (error) {
		console.error('Teknikk-oppsummering feilet:', error);
		return json({ error: 'Kunne ikke lage oppsummering' }, { status: 500 });
	}
};
