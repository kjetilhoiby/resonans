import { json, error } from '@sveltejs/kit';
import { isRemaConfigured } from '$lib/server/integrations/rema';
import { startRemaConnect } from '$lib/server/integrations/rema-connect';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rema/connect/start
 *
 * Lager PKCE-verifikator og state (i en kryptert httpOnly-cookie) og returnerer
 * innloggingsadressen hos Rema. Se `rema-connect.ts` for hvorfor flyten har to
 * steg: redirecten tilhører Æ-appen, så koden må limes inn.
 */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.userId) throw error(401, 'Ikke innlogget');
	if (!isRemaConfigured()) {
		// 503, ikke 500: konfigurasjon hos oss, ikke en feil hos Rema.
		throw error(503, 'Rema er ikke konfigurert på serveren (REMA_APIM_SUBSCRIPTION_KEY mangler).');
	}
	return json({ authorizeUrl: startRemaConnect(cookies) });
};
