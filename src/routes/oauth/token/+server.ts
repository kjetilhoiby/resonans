import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAUTH_CORS_HEADERS, parseBasicAuth } from '$lib/server/oauth/oauth-logic';
import {
	authenticateClient,
	exchangeAuthorizationCode,
	getClient,
	refreshGrant
} from '$lib/server/oauth/oauth-store';

const NO_STORE = { ...OAUTH_CORS_HEADERS, 'cache-control': 'no-store', pragma: 'no-cache' };

function oauthError(error: string, description: string, status = 400) {
	return json({ error, error_description: description }, { status, headers: NO_STORE });
}

/**
 * Leser parametrene som `x-www-form-urlencoded` (RFC 6749), og godtar JSON for
 * klienter som sender det likevel.
 *
 * NB: denne stien er unntatt CSRF-sjekken (`$lib/server/csrf.ts`). Uten unntaket
 * avviser SvelteKit hver eneste token-forespørsel i drift — de kommer fra Claude
 * og ChatGPT sine servere, uten Origin — mens alt virker lokalt.
 */
async function readParams(request: Request): Promise<URLSearchParams> {
	const type = request.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(body)) {
			if (typeof value === 'string') params.set(key, value);
		}
		return params;
	}
	return new URLSearchParams(await request.text());
}

export const POST: RequestHandler = async ({ request }) => {
	const params = await readParams(request);

	const basic = parseBasicAuth(request.headers.get('authorization'));
	const clientId = basic?.clientId ?? params.get('client_id');
	const clientSecret = basic?.clientSecret ?? params.get('client_secret');

	const client = await getClient(clientId);
	if (!client || !authenticateClient(client, clientSecret)) {
		return oauthError('invalid_client', 'Ukjent klient eller feil klienthemmelighet.', 401);
	}

	const grantType = params.get('grant_type');
	let result;
	if (grantType === 'authorization_code') {
		const code = params.get('code');
		if (!code) return oauthError('invalid_request', 'Mangler code.');
		result = await exchangeAuthorizationCode({
			code,
			clientId: client.clientId,
			redirectUri: params.get('redirect_uri'),
			codeVerifier: params.get('code_verifier')
		});
	} else if (grantType === 'refresh_token') {
		const refreshToken = params.get('refresh_token');
		if (!refreshToken) return oauthError('invalid_request', 'Mangler refresh_token.');
		result = await refreshGrant({ refreshToken, clientId: client.clientId });
	} else {
		return oauthError('unsupported_grant_type', `grant_type støttes ikke: ${grantType ?? '(mangler)'}.`);
	}

	if ('error' in result) return oauthError(result.error, result.description);
	return json(result, { headers: NO_STORE });
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
