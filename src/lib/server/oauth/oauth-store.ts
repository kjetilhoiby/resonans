/**
 * Lagringen bak OAuth-serveren for MCP: klienter, engangskoder og tilkoblinger.
 *
 * Reglene (PKCE, redirect-URI-er, metadata) bor rent i `oauth-logic.ts`. Her er
 * det bare én ting å passe på utover det vanlige: alt som kan brukes som
 * legitimasjon lagres som en hash, og en kode eller et refresh-token skal bare
 * kunne brukes ÉN gang — derfor `DELETE … RETURNING` og `UPDATE … WHERE hash = …
 * RETURNING`, som er atomiske, framfor å lese og så skrive.
 */

import { env } from '$env/dynamic/private';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { db } from '$lib/db';
import { oauthAuthorizationCodes, oauthClients, oauthGrants } from '$lib/db/schema';
import {
	ACCESS_TOKEN_TTL_SECONDS,
	AUTH_CODE_TTL_SECONDS,
	REFRESH_TOKEN_TTL_DAYS,
	generateClientId,
	generateToken,
	hashToken,
	isTokenOfKind,
	verifyPkceS256,
	type ClientRegistration,
	type TokenEndpointAuthMethod
} from './oauth-logic';

function hash(token: string): string {
	return hashToken(token, env.EXTERNAL_API_SECRET_PEPPER ?? '');
}

export type OAuthClient = typeof oauthClients.$inferSelect;

export async function registerClient(
	registration: ClientRegistration
): Promise<{ client: OAuthClient; clientSecret: string | null }> {
	const clientSecret =
		registration.tokenEndpointAuthMethod === 'none' ? null : generateToken('clientSecret');
	const [client] = await db
		.insert(oauthClients)
		.values({
			clientId: generateClientId(),
			clientName: registration.clientName,
			redirectUris: registration.redirectUris,
			tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
			clientSecretHash: clientSecret ? hash(clientSecret) : null
		})
		.returning();
	console.info(
		`[oauth] klient registrert id=${client.clientId} navn=${JSON.stringify(client.clientName)} auth=${client.tokenEndpointAuthMethod}`
	);
	return { client, clientSecret };
}

export async function getClient(clientId: string | null | undefined): Promise<OAuthClient | null> {
	if (!clientId) return null;
	const client = await db.query.oauthClients.findFirst({ where: eq(oauthClients.clientId, clientId) });
	return client ?? null;
}

/**
 * En konfidensiell klient må vise hemmeligheten sin; en offentlig klient har
 * ingen, og er bundet av PKCE alene.
 */
export function authenticateClient(client: OAuthClient, presentedSecret: string | null): boolean {
	const method = client.tokenEndpointAuthMethod as TokenEndpointAuthMethod;
	if (method === 'none') return true;
	if (!presentedSecret || !client.clientSecretHash) return false;
	const a = Buffer.from(hash(presentedSecret));
	const b = Buffer.from(client.clientSecretHash);
	return a.length === b.length && timingSafeEqual(a, b);
}

export async function createAuthorizationCode(params: {
	clientId: string;
	userId: string;
	redirectUri: string;
	codeChallenge: string;
	scope: string;
}): Promise<string> {
	const code = generateToken('code');
	const now = new Date();
	// Rydder utløpte koder i forbifarten. En forlatt innlogging etterlater én rad.
	await db.delete(oauthAuthorizationCodes).where(lt(oauthAuthorizationCodes.expiresAt, now));
	await db.insert(oauthAuthorizationCodes).values({
		codeHash: hash(code),
		clientId: params.clientId,
		userId: params.userId,
		redirectUri: params.redirectUri,
		codeChallenge: params.codeChallenge,
		scope: params.scope,
		expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000)
	});
	return code;
}

export interface IssuedTokens {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token: string;
	scope: string;
}

export type TokenError = { error: 'invalid_grant' | 'invalid_request'; description: string };

function freshTokens() {
	const now = Date.now();
	const accessToken = generateToken('access');
	const refreshToken = generateToken('refresh');
	return {
		accessToken,
		refreshToken,
		columns: {
			accessTokenHash: hash(accessToken),
			accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
			refreshTokenHash: hash(refreshToken),
			refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
		}
	};
}

function toResponse(accessToken: string, refreshToken: string, scope: string): IssuedTokens {
	return {
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		refresh_token: refreshToken,
		scope
	};
}

export async function exchangeAuthorizationCode(params: {
	code: string;
	clientId: string;
	redirectUri: string | null;
	codeVerifier: string | null;
}): Promise<IssuedTokens | TokenError> {
	if (!params.codeVerifier) return { error: 'invalid_request', description: 'Mangler code_verifier.' };

	// Slettes FØR den sjekkes: en kode som feiler en sjekk er også brukt opp,
	// så den ikke kan prøves på nytt med en annen verifier.
	const [row] = await db
		.delete(oauthAuthorizationCodes)
		.where(eq(oauthAuthorizationCodes.codeHash, hash(params.code)))
		.returning();

	if (!row) return { error: 'invalid_grant', description: 'Ukjent eller allerede brukt kode.' };
	if (row.expiresAt.getTime() < Date.now()) return { error: 'invalid_grant', description: 'Koden er utløpt.' };
	if (row.clientId !== params.clientId) return { error: 'invalid_grant', description: 'Koden tilhører en annen klient.' };
	if (params.redirectUri !== null && params.redirectUri !== row.redirectUri) {
		return { error: 'invalid_grant', description: 'redirect_uri stemmer ikke med autorisasjonen.' };
	}
	if (!verifyPkceS256(params.codeVerifier, row.codeChallenge)) {
		return { error: 'invalid_grant', description: 'PKCE-verifiseringen feilet.' };
	}

	const tokens = freshTokens();
	await db.insert(oauthGrants).values({
		userId: row.userId,
		clientId: row.clientId,
		scope: row.scope,
		...tokens.columns
	});
	console.info(`[oauth] tilkobling opprettet klient=${row.clientId} user=${row.userId}`);
	return toResponse(tokens.accessToken, tokens.refreshToken, row.scope);
}

/**
 * Refresh-token roteres ved hver bruk (OAuth 2.1 §4.3.1 for offentlige klienter).
 * Det gamle slutter å virke idet det nye utstedes — betingelsen på den gamle
 * hashen i UPDATE-en gjør at to samtidige forsøk ikke begge vinner.
 */
export async function refreshGrant(params: {
	refreshToken: string;
	clientId: string;
}): Promise<IssuedTokens | TokenError> {
	if (!isTokenOfKind(params.refreshToken, 'refresh')) {
		return { error: 'invalid_grant', description: 'Ukjent refresh_token.' };
	}
	const tokens = freshTokens();
	const now = new Date();
	const [grant] = await db
		.update(oauthGrants)
		.set({ ...tokens.columns, lastUsedAt: now })
		.where(
			and(
				eq(oauthGrants.refreshTokenHash, hash(params.refreshToken)),
				eq(oauthGrants.clientId, params.clientId),
				isNull(oauthGrants.revokedAt),
				gt(oauthGrants.refreshExpiresAt, now)
			)
		)
		.returning({ scope: oauthGrants.scope });

	if (!grant) return { error: 'invalid_grant', description: 'Ukjent, utløpt eller tilbakekalt refresh_token.' };
	return toResponse(tokens.accessToken, tokens.refreshToken, grant.scope);
}

export interface AccessTokenAuth {
	userId: string;
	clientId: string;
	grantId: string;
	scope: string;
	expiresAt: Date;
}

export async function resolveAccessToken(token: string | null): Promise<AccessTokenAuth | null> {
	if (!token || !isTokenOfKind(token, 'access')) return null;
	const now = new Date();
	const grant = await db.query.oauthGrants.findFirst({
		where: and(
			eq(oauthGrants.accessTokenHash, hash(token)),
			isNull(oauthGrants.revokedAt),
			gt(oauthGrants.accessExpiresAt, now)
		)
	});
	if (!grant) return null;

	// «Sist brukt» i innstillingene. Ett minutts oppløsning holder, og sparer en
	// skriving per verktøykall i en samtale som kaller mange.
	if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 60_000) {
		await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, grant.id));
	}

	return {
		userId: grant.userId,
		clientId: grant.clientId,
		grantId: grant.id,
		scope: grant.scope,
		expiresAt: grant.accessExpiresAt
	};
}

/**
 * RFC 7009. Et token av hvilken som helst av de to typene tilbakekaller hele
 * tilkoblingen — en klient som logger ut, vil ut. Ukjente token gir også 200.
 */
export async function revokeToken(token: string, clientId: string): Promise<void> {
	const column = isTokenOfKind(token, 'refresh')
		? oauthGrants.refreshTokenHash
		: isTokenOfKind(token, 'access')
			? oauthGrants.accessTokenHash
			: null;
	if (!column) return;
	await db
		.update(oauthGrants)
		.set({ revokedAt: new Date() })
		.where(and(eq(column, hash(token)), eq(oauthGrants.clientId, clientId), isNull(oauthGrants.revokedAt)));
}

export interface ConnectedClient {
	grantId: string;
	clientName: string | null;
	redirectHost: string | null;
	createdAt: Date;
	lastUsedAt: Date | null;
}

export async function listConnectedClients(userId: string): Promise<ConnectedClient[]> {
	const rows = await db
		.select({
			grantId: oauthGrants.id,
			clientName: oauthClients.clientName,
			redirectUris: oauthClients.redirectUris,
			createdAt: oauthGrants.createdAt,
			lastUsedAt: oauthGrants.lastUsedAt
		})
		.from(oauthGrants)
		.innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.clientId))
		.where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
		.orderBy(desc(oauthGrants.createdAt));

	return rows.map((row) => {
		let host: string | null = null;
		try {
			host = row.redirectUris[0] ? new URL(row.redirectUris[0]).host : null;
		} catch {
			host = null;
		}
		return {
			grantId: row.grantId,
			clientName: row.clientName,
			redirectHost: host,
			createdAt: row.createdAt,
			lastUsedAt: row.lastUsedAt
		};
	});
}

export async function revokeUserGrant(userId: string, grantId: string): Promise<boolean> {
	const [revoked] = await db
		.update(oauthGrants)
		.set({ revokedAt: new Date() })
		.where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
		.returning({ id: oauthGrants.id });
	return Boolean(revoked);
}
