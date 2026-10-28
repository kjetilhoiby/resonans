import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAUTH_CORS_HEADERS, parseClientRegistration } from '$lib/server/oauth/oauth-logic';
import { registerClient } from '$lib/server/oauth/oauth-store';

/**
 * Dynamisk klientregistrering (RFC 7591). Åpen med vilje: Claude og ChatGPT
 * registrerer seg selv første gang brukeren legger til connectoren. En
 * registrering gir ingen tilgang — det krever en innlogget bruker som godkjenner
 * klienten på `/oauth/authorize`, der redirect-hosten vises.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'Kroppen må være JSON.' },
			{ status: 400, headers: OAUTH_CORS_HEADERS }
		);
	}

	const parsed = parseClientRegistration(body);
	if (!parsed.ok) {
		return json(
			{ error: parsed.error, error_description: parsed.description },
			{ status: 400, headers: OAUTH_CORS_HEADERS }
		);
	}

	const { client, clientSecret } = await registerClient(parsed.registration);
	return json(
		{
			client_id: client.clientId,
			client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
			...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
			client_name: client.clientName ?? undefined,
			redirect_uris: client.redirectUris,
			token_endpoint_auth_method: client.tokenEndpointAuthMethod,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		},
		{ status: 201, headers: { ...OAUTH_CORS_HEADERS, 'cache-control': 'no-store' } }
	);
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
