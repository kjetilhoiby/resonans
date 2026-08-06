import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listLiveModels,
	GeminiNotConfiguredError,
	GeminiTokenMintError
} from '$lib/server/integrations/gemini-live';

/**
 * GET /api/apps/gemini/models  (Bearer rsn_)
 *
 * Hvilke Live-modeller Google tilbyr akkurat nå, og hvilken et token får hvis
 * ingenting velges.
 *
 * Finnes fordi modellnavnene skifter fra uke til uke. En konstant i koden vår er
 * en påstand med utløpsdato — dette er et spørsmål, besvart av Google i det
 * øyeblikket det stilles. Filtreringen går på `supportedGenerationMethods`, altså
 * modellens egen erklæring om at den kan brukes over WebSocket, og ikke på om
 * navnet inneholder «live».
 *
 * `defaultIsStale: true` betyr at modellen vi ville brukt ikke finnes i katalogen
 * lenger. Det er verdt å se etter: minting fortsetter å virke, og feilen dukker
 * ikke opp før noen prøver å koble til.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		return json(await listLiveModels());
	} catch (err) {
		if (err instanceof GeminiNotConfiguredError) {
			console.error('[gemini-live] GEMINI_API_KEY mangler i miljøet');
			return json({ error: err.message }, { status: 503 });
		}
		if (err instanceof GeminiTokenMintError) {
			console.error(`[gemini-live] modellkatalog feilet: ${err.message}`);
			return json({ error: err.message }, { status: err.status });
		}
		throw err;
	}
};
