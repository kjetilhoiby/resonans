import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import {
	buildRedirect,
	checkAuthorizeRequest,
	mcpResourceUrl,
	redirectHost,
	type AuthorizeCheck
} from '$lib/server/oauth/oauth-logic';
import { createAuthorizationCode, getClient } from '$lib/server/oauth/oauth-store';
import { sessionUserIdForAppCallback } from '$lib/server/request-user-sources';

/**
 * Samtykkesiden: her blir en registrert klient til en tilkobling.
 *
 * Stien er offentlig (`public-paths.ts`), fordi hooks sender en uinnlogget
 * bruker til `/auth?next=<sti>` UTEN spørrestrengen — og hele forespørselen
 * står i spørrestrengen. Innloggingen sjekkes derfor her, og brukeren leses BARE
 * fra økta: siden utsteder legitimasjon, så samme regel som
 * `/api/apps/callback` (se CLAUDE.md, «En offentlig sti som utsteder
 * legitimasjon leser brukeren fra ØKTA»).
 */

async function check(params: URLSearchParams, origin: string): Promise<AuthorizeCheck> {
	const client = await getClient(params.get('client_id'));
	return checkAuthorizeRequest(params, client, mcpResourceUrl(origin));
}

function redirectWithError(result: Extract<AuthorizeCheck, { kind: 'redirect' }>, origin: string): never {
	redirect(
		303,
		buildRedirect(result.redirectUri, {
			error: result.error,
			error_description: result.description,
			state: result.state,
			iss: origin
		})
	);
}

async function sessionUser(event: Pick<RequestEvent, 'locals'>) {
	const session = typeof event.locals.auth === 'function' ? await event.locals.auth() : null;
	return { userId: sessionUserIdForAppCallback(session), email: session?.user?.email ?? null };
}

export const load: PageServerLoad = async (event) => {
	const { url, setHeaders } = event;
	// Samtykket skal aldri kunne rammes inn av en annen side (clickjacking).
	setHeaders({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });

	const result = await check(url.searchParams, url.origin);
	if (result.kind === 'fatal') return { fatal: result.message };
	if (result.kind === 'redirect') redirectWithError(result, url.origin);

	const { userId, email } = await sessionUser(event);
	if (!userId) redirect(303, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`);

	const client = await getClient(result.request.clientId);
	return {
		fatal: null,
		clientName: client?.clientName ?? null,
		redirectHost: redirectHost(result.request.redirectUri),
		email,
		params: url.searchParams.toString()
	};
};

/** Skjemaet bærer hele den opprinnelige forespørselen, og den sjekkes på nytt. */
async function checkPosted(event: RequestEvent) {
	const form = await event.request.formData();
	const raw = form.get('params');
	const params = new URLSearchParams(typeof raw === 'string' ? raw : '');
	const result = await check(params, event.url.origin);
	if (result.kind === 'fatal') error(400, result.message);
	if (result.kind === 'redirect') redirectWithError(result, event.url.origin);
	return result.request;
}

export const actions = {
	approve: async (event) => {
		const request = await checkPosted(event);
		const { userId } = await sessionUser(event);
		if (!userId) error(401, 'Ikke innlogget.');

		const code = await createAuthorizationCode({
			clientId: request.clientId,
			userId,
			redirectUri: request.redirectUri,
			codeChallenge: request.codeChallenge,
			scope: request.scope
		});
		redirect(303, buildRedirect(request.redirectUri, { code, state: request.state, iss: event.url.origin }));
	},
	deny: async (event) => {
		const request = await checkPosted(event);
		redirect(
			303,
			buildRedirect(request.redirectUri, {
				error: 'access_denied',
				error_description: 'Brukeren avslo tilkoblingen.',
				state: request.state,
				iss: event.url.origin
			})
		);
	}
} satisfies Actions;
