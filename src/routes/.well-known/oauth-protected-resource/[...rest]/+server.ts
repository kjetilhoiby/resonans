import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAUTH_CORS_HEADERS, protectedResourceMetadata } from '$lib/server/oauth/oauth-logic';

/**
 * RFC 9728. Svarer både på roten og på `/mcp`-suffikset: klienter spør
 * `/.well-known/oauth-protected-resource/mcp` først (stien til ressursen satt
 * inn bak well-known), og faller tilbake på roten. Begge beskriver `/mcp`.
 */
export const GET: RequestHandler = ({ url }) =>
	json(protectedResourceMetadata(url.origin), { headers: OAUTH_CORS_HEADERS });

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
