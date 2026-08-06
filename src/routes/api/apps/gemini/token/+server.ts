import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	mintLiveToken,
	GeminiNotConfiguredError,
	GeminiTokenMintError
} from '$lib/server/integrations/gemini-live';
import { GeminiTokenShapeError } from '$lib/domain/ai/gemini-live-token';

/**
 * POST /api/apps/gemini/token  (Bearer rsn_)
 *
 * Minter et kortlevd Gemini Live-token til Ekko, slik at appen kan koble direkte
 * til Googles WebSocket uten å ha `GEMINI_API_KEY` i bundelen. Samme arbeidsdeling
 * som `/api/apps/tesla/state`: credentials bor på serveren.
 *
 * Kroppen er valgfri. `{ "ttlSeconds": 1800, "newSessionSeconds": 120, "uses": 3 }`
 * kan justere levetidene innenfor grensene i `gemini-live-token.ts`; verdier
 * utenfor klippes framfor å avvises, siden en app som ber om 45 minutter er bedre
 * tjent med 30 enn med en 400.
 *
 * POST, ikke GET: kallet har en effekt hos Google (kvote), og et token skal ikke
 * kunne mintes av en prefetch eller en lenke noen trykker på ved et uhell.
 *
 * ## Attribusjon
 *
 * Hvert token knyttes til brukeren gjennom `Bearer rsn_`, og loggen skriver
 * hvem som mintet det. Tokenet selv er anonymt hos Google, så vår logg er eneste
 * sted koblingen finnes — den er det som gjør et misbrukt token sporbart, og
 * `user_api_secrets` er stedet det trekkes tilbake.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const num = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;

	try {
		const token = await mintLiveToken({
			ttlSeconds: num(body?.ttlSeconds),
			newSessionSeconds: num(body?.newSessionSeconds),
			uses: num(body?.uses)
		});

		console.log(
			`[gemini-live] mintet token for bruker=${userId} modell=${token.model} uses=${token.uses} utløper=${token.expiresAt ?? 'ukjent'}`
		);

		return json({
			token: token.token,
			websocketUrl: token.websocketUrl,
			model: token.model,
			uses: token.uses,
			expiresAt: token.expiresAt,
			newSessionExpiresAt: token.newSessionExpiresAt
		});
	} catch (err) {
		if (err instanceof GeminiNotConfiguredError) {
			// 503, ikke 502: dette er en manglende konfigurasjon hos oss, og appen
			// skal ikke prøve igjen i sløyfe på noe et menneske må rette.
			console.error('[gemini-live] GEMINI_API_KEY mangler i miljøet');
			return json({ error: err.message }, { status: 503 });
		}
		if (err instanceof GeminiTokenMintError) {
			console.error(`[gemini-live] minting feilet for bruker=${userId}: ${err.message}`);
			return json({ error: err.message }, { status: err.status });
		}
		if (err instanceof GeminiTokenShapeError) {
			console.error(`[gemini-live] uventet svarform fra Google: ${err.message}`);
			return json({ error: err.message }, { status: 502 });
		}
		throw err;
	}
};
