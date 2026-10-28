import type { RequestHandler } from './$types';
import { OAUTH_CORS_HEADERS, parseBasicAuth } from '$lib/server/oauth/oauth-logic';
import { authenticateClient, getClient, revokeToken } from '$lib/server/oauth/oauth-store';

/**
 * RFC 7009. Svarer 200 også for ukjente token, som spesifikasjonen krever — et
 * svar som skilte dem ville latt hvem som helst prøve ut token.
 * Unntatt CSRF-sjekken av samme grunn som `/oauth/token`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const params = new URLSearchParams(await request.text());
	const basic = parseBasicAuth(request.headers.get('authorization'));
	const client = await getClient(basic?.clientId ?? params.get('client_id'));
	if (!client || !authenticateClient(client, basic?.clientSecret ?? params.get('client_secret'))) {
		return new Response(JSON.stringify({ error: 'invalid_client' }), {
			status: 401,
			headers: { ...OAUTH_CORS_HEADERS, 'content-type': 'application/json' }
		});
	}

	const token = params.get('token');
	if (token) await revokeToken(token, client.clientId);
	return new Response(null, { status: 200, headers: OAUTH_CORS_HEADERS });
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
