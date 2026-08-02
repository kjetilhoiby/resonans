import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { estimateIntake, NutritionEstimateError } from '$lib/server/nutrition/estimate-intake';
import { parseEstimateResponse, type NutritionEstimate } from '$lib/domain/nutrition/estimate';

/**
 * Estimerer et måltid uten å lagre noe.
 *
 * To steg med vilje: brukeren skal se og kunne rette tallene før de havner i
 * loggen. Det er også det som gjør «beskriv for å få mengde»-løkka mulig — send
 * forrige estimat inn igjen sammen med en utfyllende beskrivelse.
 *
 * NB: ikke under /api/health/ — se `public-paths.ts`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as
		| { text?: string; imageUrl?: string; prior?: unknown }
		| null;

	if (!body) {
		return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });
	}

	// Forrige estimat kommer fra klienten og er ikke til å stole på. Det går
	// gjennom samme parser som modellsvaret før det brukes i en prompt.
	const prior: NutritionEstimate | null = body.prior
		? parseEstimateResponse(body.prior, 'manual')
		: null;

	try {
		const estimate = await estimateIntake({
			text: body.text ?? null,
			imageUrl: body.imageUrl ?? null,
			prior
		});
		return json({ estimate });
	} catch (err) {
		if (err instanceof NutritionEstimateError) {
			return json({ error: err.message }, { status: 400 });
		}
		// Uventet: la handleError logge den med rute og stack.
		throw err;
	}
};
