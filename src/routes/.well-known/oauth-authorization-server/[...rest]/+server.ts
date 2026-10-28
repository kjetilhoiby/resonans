import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAUTH_CORS_HEADERS, authorizationServerMetadata } from '$lib/server/oauth/oauth-logic';

/**
 * RFC 8414. Rest-parameteren fanger også `/.well-known/oauth-authorization-server/mcp`,
 * som eldre MCP-klienter spør etter når de antar at ressursen er sin egen server.
 */
export const GET: RequestHandler = ({ url }) =>
	json(authorizationServerMetadata(url.origin), { headers: OAUTH_CORS_HEADERS });

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
