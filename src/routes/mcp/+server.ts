import type { RequestHandler } from './$types';
import { handleMcpRequest } from '$lib/server/mcp/mcp-server';
import { OAUTH_CORS_HEADERS, parseBearer, wwwAuthenticate } from '$lib/server/oauth/oauth-logic';
import { resolveAccessToken } from '$lib/server/oauth/oauth-store';

/**
 * MCP-endepunktet (Streamable HTTP). Se docs/mcp.md.
 *
 * Stien er offentlig i `public-paths.ts` og autentiserer selv: bare et
 * `rsm_at_`-token fra `/oauth/token` slipper inn — ikke en økt, ikke en
 * `rsn_`-hemmelighet. En 401 med `WWW-Authenticate` er det som får Claude og
 * ChatGPT til å starte innloggingen, så den MÅ ha `resource_metadata`.
 */

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(OAUTH_CORS_HEADERS)) headers.set(key, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unauthorized(origin: string, hadToken: boolean): Response {
	return new Response(
		JSON.stringify({
			error: hadToken ? 'invalid_token' : 'unauthorized',
			error_description: hadToken ? 'Tokenet er ugyldig, utløpt eller tilbakekalt.' : 'Logg inn med OAuth.'
		}),
		{
			status: 401,
			headers: {
				...OAUTH_CORS_HEADERS,
				'content-type': 'application/json',
				'www-authenticate': wwwAuthenticate(origin, hadToken ? 'invalid_token' : undefined)
			}
		}
	);
}

export const POST: RequestHandler = async ({ request, url }) => {
	const token = parseBearer(request.headers.get('authorization'));
	const auth = await resolveAccessToken(token);
	if (!auth) return unauthorized(url.origin, Boolean(token));
	return withCors(await handleMcpRequest(request, auth));
};

/**
 * Ingen server-initierte meldinger og ingen økter, så verken en GET-strøm eller
 * DELETE av en økt har noe å gjøre. 405 er svaret spesifikasjonen gir for det.
 */
const methodNotAllowed: RequestHandler = () =>
	new Response(null, { status: 405, headers: { ...OAUTH_CORS_HEADERS, allow: 'POST, OPTIONS' } });

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
