/**
 * OAuth 2.1 for MCP-serveren — ren logikk uten `$env` og database.
 *
 * Resonans er sin egen autorisasjonsserver: Claude og ChatGPT oppdager den via
 * `/.well-known/oauth-protected-resource`, registrerer seg selv (RFC 7591), og
 * sender brukeren til `/oauth/authorize`. Der logger brukeren inn med Google som
 * ellers og godkjenner klienten. Se docs/mcp.md.
 *
 * Bare autorisasjonskode med PKCE (S256). Ingen implicit, ingen password-grant —
 * OAuth 2.1 har fjernet begge, og MCP-spesifikasjonen krever PKCE.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_SCOPE = 'resonans';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;
export const AUTH_CODE_TTL_SECONDS = 5 * 60;

export const MCP_PATH = '/mcp';

/**
 * Prefiks per tokentype. `rsm_` skiller dem fra `rsn_`-hemmelighetene, som
 * gjelder hele `/api` — et MCP-token gir bare tilgang til `/mcp`.
 */
const TOKEN_PREFIX = {
	access: 'rsm_at_',
	refresh: 'rsm_rt_',
	code: 'rsm_code_',
	clientSecret: 'rsm_cs_'
} as const;

export type TokenKind = keyof typeof TOKEN_PREFIX;

export function generateToken(kind: TokenKind): string {
	return `${TOKEN_PREFIX[kind]}${randomBytes(32).toString('base64url')}`;
}

export function generateClientId(): string {
	return `rsm_client_${randomBytes(16).toString('base64url')}`;
}

export function isTokenOfKind(token: string, kind: TokenKind): boolean {
	return token.startsWith(TOKEN_PREFIX[kind]);
}

/** Alt som lagres er en hash. Pepperen er samme som for `rsn_`-hemmelighetene. */
export function hashToken(token: string, pepper: string): string {
	return createHash('sha256').update(`${pepper}:oauth:${token}`).digest('hex');
}

/** RFC 7636: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
	// 43–128 tegn fra det ureserverte alfabetet, ellers er det ikke en verifier.
	if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
	const computed = createHash('sha256').update(verifier).digest('base64url');
	const a = Buffer.from(computed);
	const b = Buffer.from(challenge);
	return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Hvilke redirect-URI-er en klient får registrere.
 *
 * https overalt; http bare mot loopback (Claude Code og MCP Inspector lytter
 * lokalt). Ingen fragment — koden skal i spørrestrengen. Egendefinerte skjema
 * (`cursor://…`) avvises: ChatGPT og Claude bruker https, og et skjema kan
 * registreres av hvilken app som helst på telefonen.
 */
export function isAllowedRedirectUri(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.hash) return false;
	if (url.protocol === 'https:') return true;
	if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
	return false;
}

/** Eksakt match, som OAuth 2.1 krever. Ingen prefiks, ingen jokertegn. */
export function redirectUriIsRegistered(registered: readonly string[], requested: string): boolean {
	return registered.includes(requested);
}

export type TokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

const AUTH_METHODS: readonly TokenEndpointAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];

export interface ClientRegistration {
	clientName: string | null;
	redirectUris: string[];
	tokenEndpointAuthMethod: TokenEndpointAuthMethod;
}

export type RegistrationResult =
	| { ok: true; registration: ClientRegistration }
	| { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_LENGTH = 100;

/** RFC 7591-kroppen → det vi lagrer. Ukjente felt ignoreres, som spesifikasjonen sier. */
export function parseClientRegistration(body: unknown): RegistrationResult {
	if (!body || typeof body !== 'object') {
		return { ok: false, error: 'invalid_client_metadata', description: 'Kroppen må være et JSON-objekt.' };
	}
	const input = body as Record<string, unknown>;

	const uris = input.redirect_uris;
	if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
		return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris må være en liste med 1–10 URI-er.' };
	}
	for (const uri of uris) {
		if (typeof uri !== 'string' || !isAllowedRedirectUri(uri)) {
			return {
				ok: false,
				error: 'invalid_redirect_uri',
				description: `Ugyldig redirect_uri: ${String(uri)}. Bruk https, eller http mot localhost.`
			};
		}
	}

	const grantTypes = input.grant_types;
	if (grantTypes !== undefined) {
		if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')) {
			return { ok: false, error: 'invalid_client_metadata', description: 'grant_types må inneholde authorization_code.' };
		}
	}
	const responseTypes = input.response_types;
	if (responseTypes !== undefined) {
		if (!Array.isArray(responseTypes) || !responseTypes.includes('code')) {
			return { ok: false, error: 'invalid_client_metadata', description: 'response_types må inneholde code.' };
		}
	}

	const method = input.token_endpoint_auth_method ?? 'none';
	if (typeof method !== 'string' || !AUTH_METHODS.includes(method as TokenEndpointAuthMethod)) {
		return {
			ok: false,
			error: 'invalid_client_metadata',
			description: `token_endpoint_auth_method støttes ikke: ${String(method)}.`
		};
	}

	const rawName = typeof input.client_name === 'string' ? input.client_name.trim() : '';
	const clientName = rawName ? rawName.slice(0, MAX_CLIENT_NAME_LENGTH) : null;

	return {
		ok: true,
		registration: {
			clientName,
			redirectUris: [...new Set(uris as string[])],
			tokenEndpointAuthMethod: method as TokenEndpointAuthMethod
		}
	};
}

export interface RegisteredClient {
	clientId: string;
	clientName: string | null;
	redirectUris: string[];
}

export interface AuthorizeRequest {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state: string | null;
	scope: string;
}

/**
 * Utfallet av å sjekke en `/oauth/authorize`-forespørsel.
 *
 * Skillet mellom `fatal` og `redirect` er RFC 6749 §4.1.2.1: er klienten eller
 * redirect-URI-en ugyldig, skal brukeren IKKE sendes videre — ellers blir
 * endepunktet en åpen redirect. Alt annet meldes tilbake til klienten.
 */
export type AuthorizeCheck =
	| { kind: 'fatal'; message: string }
	| { kind: 'redirect'; redirectUri: string; error: string; description: string; state: string | null }
	| { kind: 'ok'; request: AuthorizeRequest };

export function checkAuthorizeRequest(
	params: URLSearchParams,
	client: RegisteredClient | null,
	expectedResource: string
): AuthorizeCheck {
	const clientId = params.get('client_id');
	if (!clientId) return { kind: 'fatal', message: 'Mangler client_id.' };
	if (!client || client.clientId !== clientId) return { kind: 'fatal', message: 'Ukjent klient.' };

	// Med én registrert URI kan den utelates (RFC 6749 §3.1.2.3).
	const requestedRedirect = params.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
	if (!requestedRedirect) return { kind: 'fatal', message: 'Mangler redirect_uri.' };
	if (!redirectUriIsRegistered(client.redirectUris, requestedRedirect)) {
		return { kind: 'fatal', message: 'redirect_uri er ikke registrert for denne klienten.' };
	}

	const state = params.get('state');
	const fail = (error: string, description: string): AuthorizeCheck => ({
		kind: 'redirect',
		redirectUri: requestedRedirect,
		error,
		description,
		state
	});

	if (params.get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'Bare response_type=code støttes.');
	}
	const codeChallenge = params.get('code_challenge');
	if (!codeChallenge) return fail('invalid_request', 'PKCE kreves: mangler code_challenge.');
	if ((params.get('code_challenge_method') ?? 'plain') !== 'S256') {
		return fail('invalid_request', 'Bare code_challenge_method=S256 støttes.');
	}
	if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
		return fail('invalid_request', 'code_challenge har feil form.');
	}

	const resource = params.get('resource');
	if (resource && !resourceMatches(resource, expectedResource)) {
		return fail('invalid_target', 'Ukjent resource.');
	}

	return {
		kind: 'ok',
		request: { clientId, redirectUri: requestedRedirect, codeChallenge, state, scope: OAUTH_SCOPE }
	};
}

/**
 * RFC 8707: `resource` skal peke på MCP-serveren. Vi godtar også bare originen,
 * siden noen klienter sender den kanoniske server-URI-en uten sti.
 */
export function resourceMatches(resource: string, expectedResource: string): boolean {
	const normalize = (value: string) => value.replace(/\/+$/, '');
	const wanted = normalize(expectedResource);
	const given = normalize(resource);
	return given === wanted || given === new URL(wanted).origin;
}

/** Legger parametre på en redirect-URI uten å røre det som alt står der. */
export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
	const url = new URL(redirectUri);
	for (const [key, value] of Object.entries(params)) {
		if (value !== null && value !== undefined) url.searchParams.set(key, value);
	}
	return url.toString();
}

/** `Authorization: Basic base64(id:secret)`, med URL-dekoding som RFC 6749 §2.3.1 krever. */
export function parseBasicAuth(header: string | null): { clientId: string; clientSecret: string } | null {
	if (!header) return null;
	const match = header.match(/^Basic\s+(.+)$/i);
	if (!match) return null;
	let decoded: string;
	try {
		decoded = Buffer.from(match[1].trim(), 'base64').toString('utf8');
	} catch {
		return null;
	}
	const sep = decoded.indexOf(':');
	if (sep < 0) return null;
	try {
		return {
			clientId: decodeURIComponent(decoded.slice(0, sep)),
			clientSecret: decodeURIComponent(decoded.slice(sep + 1))
		};
	} catch {
		return null;
	}
}

export function parseBearer(header: string | null): string | null {
	const match = header?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

export function mcpResourceUrl(origin: string): string {
	return `${origin}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(origin: string): string {
	return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** RFC 9728. */
export function protectedResourceMetadata(origin: string) {
	return {
		resource: mcpResourceUrl(origin),
		authorization_servers: [origin],
		scopes_supported: [OAUTH_SCOPE],
		bearer_methods_supported: ['header'],
		resource_name: 'Resonans'
	};
}

/** RFC 8414. */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		revocation_endpoint: `${origin}/oauth/revoke`,
		scopes_supported: [OAUTH_SCOPE],
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: AUTH_METHODS,
		revocation_endpoint_auth_methods_supported: AUTH_METHODS,
		authorization_response_iss_parameter_supported: true
	};
}

/** `WWW-Authenticate` på en 401 fra `/mcp` — det er den som starter hele innloggingen. */
export function wwwAuthenticate(origin: string, error?: 'invalid_token'): string {
	const parts = [`resource_metadata="${protectedResourceMetadataUrl(origin)}"`, `scope="${OAUTH_SCOPE}"`];
	if (error) parts.push(`error="${error}"`);
	return `Bearer ${parts.join(', ')}`;
}

/**
 * CORS på oppdagelses-, registrerings-, token- og MCP-endepunktet.
 *
 * Claude og ChatGPT kaller fra sine servere og trenger det ikke, men nettleser-
 * klienter (MCP Inspector, claude.ai i noen flyter) gjør det. `*` er trygt her:
 * ingen av endepunktene leser en informasjonskapsel, så en fremmed side får
 * ingenting den ikke alt har. Samtykkesiden står med vilje UTENFOR.
 */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
	'access-control-expose-headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
	'access-control-max-age': '86400'
};

/** Hostnavnet brukeren skal se på samtykkesiden. `client_name` er selvoppgitt; hosten er ikke det. */
export function redirectHost(redirectUri: string): string {
	try {
		return new URL(redirectUri).host;
	} catch {
		return redirectUri;
	}
}
