import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
	authorizationServerMetadata,
	buildRedirect,
	checkAuthorizeRequest,
	generateToken,
	hashToken,
	isAllowedRedirectUri,
	isTokenOfKind,
	parseBasicAuth,
	parseClientRegistration,
	protectedResourceMetadata,
	resourceMatches,
	verifyPkceS256,
	wwwAuthenticate,
	type RegisteredClient
} from './oauth-logic';

const ORIGIN = 'https://resonans.example';
const RESOURCE = `${ORIGIN}/mcp`;
const VERIFIER = 'a'.repeat(43) + '-._~';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const claude: RegisteredClient = {
	clientId: 'rsm_client_abc',
	clientName: 'Claude',
	redirectUris: ['https://claude.ai/api/mcp/auth_callback']
};

function authorizeParams(overrides: Record<string, string | null> = {}) {
	const values: Record<string, string | null> = {
		response_type: 'code',
		client_id: claude.clientId,
		redirect_uri: claude.redirectUris[0],
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 'xyz',
		resource: RESOURCE,
		...overrides
	};
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value);
	return params;
}

describe('verifyPkceS256', () => {
	it('godtar riktig verifier', () => {
		expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
	});
	it('avviser feil verifier og for korte verifiers', () => {
		expect(verifyPkceS256('b'.repeat(43), CHALLENGE)).toBe(false);
		expect(verifyPkceS256('kort', CHALLENGE)).toBe(false);
	});
	it('avviser plain (verifier === challenge)', () => {
		expect(verifyPkceS256(CHALLENGE, CHALLENGE)).toBe(false);
	});
});

describe('isAllowedRedirectUri', () => {
	it('godtar https og http mot loopback', () => {
		expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
		expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
		expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
		expect(isAllowedRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
	});
	it('avviser http mot andre verter, egne skjema, fragment og søppel', () => {
		expect(isAllowedRedirectUri('http://ond.example/cb')).toBe(false);
		expect(isAllowedRedirectUri('cursor://anysphere/cb')).toBe(false);
		expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
		expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
		expect(isAllowedRedirectUri('ikke en url')).toBe(false);
	});
});

describe('parseClientRegistration', () => {
	it('tar imot en typisk registrering fra Claude', () => {
		const result = parseClientRegistration({
			client_name: 'Claude',
			redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		});
		expect(result).toEqual({
			ok: true,
			registration: {
				clientName: 'Claude',
				redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
				tokenEndpointAuthMethod: 'none'
			}
		});
	});

	it('standard auth-metode er none, og klientnavnet kappes', () => {
		const result = parseClientRegistration({ redirect_uris: ['https://x.example/cb'], client_name: 'x'.repeat(500) });
		expect(result.ok && result.registration.tokenEndpointAuthMethod).toBe('none');
		expect(result.ok && result.registration.clientName?.length).toBe(100);
	});

	it('godtar konfidensielle klienter', () => {
		const result = parseClientRegistration({
			redirect_uris: ['https://chatgpt.com/cb'],
			token_endpoint_auth_method: 'client_secret_post'
		});
		expect(result.ok && result.registration.tokenEndpointAuthMethod).toBe('client_secret_post');
	});

	it('avviser manglende eller ugyldige redirect-URI-er', () => {
		expect(parseClientRegistration({}).ok).toBe(false);
		expect(parseClientRegistration({ redirect_uris: [] }).ok).toBe(false);
		const bad = parseClientRegistration({ redirect_uris: ['http://ond.example/cb'] });
		expect(bad.ok === false && bad.error).toBe('invalid_redirect_uri');
	});

	it('avviser grant-typer uten authorization_code og ukjente auth-metoder', () => {
		expect(parseClientRegistration({ redirect_uris: ['https://x.example/cb'], grant_types: ['client_credentials'] }).ok).toBe(false);
		expect(parseClientRegistration({ redirect_uris: ['https://x.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }).ok).toBe(false);
	});
});

describe('checkAuthorizeRequest', () => {
	it('godtar en gyldig forespørsel', () => {
		const result = checkAuthorizeRequest(authorizeParams(), claude, RESOURCE);
		expect(result).toEqual({
			kind: 'ok',
			request: {
				clientId: claude.clientId,
				redirectUri: claude.redirectUris[0],
				codeChallenge: CHALLENGE,
				state: 'xyz',
				scope: 'resonans'
			}
		});
	});

	// Ukjent klient eller redirect: aldri send brukeren videre, ellers er det en åpen redirect.
	it('er fatal for ukjent klient og uregistrert redirect_uri', () => {
		expect(checkAuthorizeRequest(authorizeParams(), null, RESOURCE).kind).toBe('fatal');
		expect(checkAuthorizeRequest(authorizeParams({ client_id: 'annen' }), claude, RESOURCE).kind).toBe('fatal');
		expect(
			checkAuthorizeRequest(authorizeParams({ redirect_uri: 'https://ond.example/cb' }), claude, RESOURCE).kind
		).toBe('fatal');
		// Prefiks er ikke match.
		expect(
			checkAuthorizeRequest(authorizeParams({ redirect_uri: `${claude.redirectUris[0]}/x` }), claude, RESOURCE).kind
		).toBe('fatal');
	});

	it('bruker den eneste registrerte URI-en når redirect_uri utelates', () => {
		const result = checkAuthorizeRequest(authorizeParams({ redirect_uri: null }), claude, RESOURCE);
		expect(result.kind === 'ok' && result.request.redirectUri).toBe(claude.redirectUris[0]);
	});

	it('melder PKCE-feil tilbake til klienten med state', () => {
		const missing = checkAuthorizeRequest(authorizeParams({ code_challenge: null }), claude, RESOURCE);
		expect(missing).toMatchObject({ kind: 'redirect', error: 'invalid_request', state: 'xyz' });
		const plain = checkAuthorizeRequest(authorizeParams({ code_challenge_method: 'plain' }), claude, RESOURCE);
		expect(plain).toMatchObject({ kind: 'redirect', error: 'invalid_request' });
		const noMethod = checkAuthorizeRequest(authorizeParams({ code_challenge_method: null }), claude, RESOURCE);
		expect(noMethod.kind).toBe('redirect');
	});

	it('melder feil response_type og fremmed resource', () => {
		expect(checkAuthorizeRequest(authorizeParams({ response_type: 'token' }), claude, RESOURCE)).toMatchObject({
			error: 'unsupported_response_type'
		});
		expect(
			checkAuthorizeRequest(authorizeParams({ resource: 'https://annen.example/mcp' }), claude, RESOURCE)
		).toMatchObject({ error: 'invalid_target' });
	});
});

describe('resourceMatches', () => {
	it('godtar MCP-URL-en, med og uten skråstrek, og bare originen', () => {
		expect(resourceMatches(RESOURCE, RESOURCE)).toBe(true);
		expect(resourceMatches(`${RESOURCE}/`, RESOURCE)).toBe(true);
		expect(resourceMatches(ORIGIN, RESOURCE)).toBe(true);
	});
	it('avviser andre stier og verter', () => {
		expect(resourceMatches(`${ORIGIN}/api`, RESOURCE)).toBe(false);
		expect(resourceMatches('https://annen.example/mcp', RESOURCE)).toBe(false);
	});
});

describe('buildRedirect', () => {
	it('beholder eksisterende spørreparametre og hopper over null', () => {
		expect(buildRedirect('https://x.example/cb?a=1', { code: 'k', state: null })).toBe('https://x.example/cb?a=1&code=k');
	});
});

describe('parseBasicAuth', () => {
	it('dekoder id og hemmelighet, også URL-kodet', () => {
		const header = `Basic ${Buffer.from('id%3Ax:hemmelig%20t').toString('base64')}`;
		expect(parseBasicAuth(header)).toEqual({ clientId: 'id:x', clientSecret: 'hemmelig t' });
	});
	it('returnerer null for andre skjema', () => {
		expect(parseBasicAuth('Bearer abc')).toBeNull();
		expect(parseBasicAuth(null)).toBeNull();
	});
});

describe('token', () => {
	it('har prefiks per type, og typene forveksles ikke', () => {
		const access = generateToken('access');
		expect(isTokenOfKind(access, 'access')).toBe(true);
		expect(isTokenOfKind(access, 'refresh')).toBe(false);
		// `rsn_`-hemmelighetene gjelder hele /api; de skal ikke se ut som MCP-token.
		expect(isTokenOfKind('rsn_abc', 'access')).toBe(false);
	});
	it('hasher med pepper', () => {
		expect(hashToken('t', 'a')).not.toBe(hashToken('t', 'b'));
		expect(hashToken('t', 'a')).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('metadata', () => {
	it('beskriver /mcp som ressursen og Resonans som autorisasjonsserver', () => {
		expect(protectedResourceMetadata(ORIGIN)).toMatchObject({
			resource: RESOURCE,
			authorization_servers: [ORIGIN]
		});
	});

	it('lover bare det serveren gjør: kode + PKCE S256', () => {
		const meta = authorizationServerMetadata(ORIGIN);
		expect(meta.issuer).toBe(ORIGIN);
		expect(meta.response_types_supported).toEqual(['code']);
		expect(meta.code_challenge_methods_supported).toEqual(['S256']);
		expect(meta.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
	});

	// Det er denne headeren som får Claude og ChatGPT til å starte innloggingen.
	it('WWW-Authenticate peker på ressursmetadataen', () => {
		expect(wwwAuthenticate(ORIGIN)).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="resonans"`
		);
		expect(wwwAuthenticate(ORIGIN, 'invalid_token')).toContain('error="invalid_token"');
	});
});
