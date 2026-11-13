/**
 * Tilkoblingen til Rema: PKCE uten callback.
 *
 * Redirecten tilhører Æ-appen (`ae-appen.appspot.com` → `bella://authorize`),
 * så koden kommer aldri til oss av seg selv. Flyten er derfor i to steg:
 *
 *  1. `start` lager verifikator + state, legger dem kryptert i en kortlevd
 *     httpOnly-cookie og returnerer innloggingsadressen.
 *  2. Brukeren logger inn, kopierer adressen hen havner på og limer den inn;
 *     `finish` leser koden, sjekker state mot cookien og bytter koden mot tokens.
 *
 * Verifikatoren forlater aldri serveren i klartekst — cookien er kryptert med
 * samme nøkkel som tokens, og bare stien under `/api/sensors/rema` ser den.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '$lib/server/crypto';
import { buildRemaAuthorizeUrl } from '$lib/domains/food/rema-receipts';
import type { RemaTokenResponse } from './rema';
import { encodeRemaCredentials } from './rema-token';
import { REMA_PROVIDER } from './rema-sync';

const PKCE_COOKIE = 'rema_pkce';
const PKCE_COOKIE_PATH = '/api/sensors/rema';
/** Innloggingen med engangskode tar et par minutter; et kvarter er romslig. */
const PKCE_TTL_SECONDS = 15 * 60;

interface PkceState {
	verifier: string;
	state: string;
	createdAt: number;
}

export function startRemaConnect(cookies: Cookies): string {
	// 64 tegn base64url — innenfor RFC 7636 sine 43–128, og bare tillatte tegn.
	const verifier = randomBytes(48).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	// Heksadesimal er alfanumerisk; redirect-siden avviser alt annet.
	const state = randomBytes(16).toString('hex');

	const payload: PkceState = { verifier, state, createdAt: Date.now() };
	cookies.set(PKCE_COOKIE, encryptSecret(JSON.stringify(payload)), {
		path: PKCE_COOKIE_PATH,
		httpOnly: true,
		secure: !dev,
		sameSite: 'strict',
		maxAge: PKCE_TTL_SECONDS
	});
	return buildRemaAuthorizeUrl({ codeChallenge: challenge, state });
}

export function readRemaPkce(cookies: Cookies): PkceState | null {
	const raw = cookies.get(PKCE_COOKIE);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(decryptSecret(raw)) as PkceState;
		if (Date.now() - parsed.createdAt > PKCE_TTL_SECONDS * 1000) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function clearRemaPkce(cookies: Cookies) {
	cookies.delete(PKCE_COOKIE, { path: PKCE_COOKIE_PATH });
}

/**
 * Mobilnummeret sendes som `x-mobile-nr`, slik appen gjør. Vi vet ikke om
 * API-et krever det, så det er valgfritt; er det oppgitt, må det se ut som et
 * telefonnummer — et feiltastet nummer i en header gir en uforklarlig 4xx.
 */
export function normalizeMobileNumber(input: unknown): { ok: true; value: string | null } | { ok: false } {
	if (input == null || (typeof input === 'string' && input.trim() === '')) return { ok: true, value: null };
	if (typeof input !== 'string') return { ok: false };
	const compact = input.replace(/[\s-]/g, '');
	return /^\+?\d{8,15}$/.test(compact) ? { ok: true, value: compact } : { ok: false };
}

export async function storeRemaConnection(
	userId: string,
	token: RemaTokenResponse,
	mobileNumber: string | null
) {
	const now = Math.floor(Date.now() / 1000);
	const credentials = encodeRemaCredentials(token, now);
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, REMA_PROVIDER))
	});
	const previous = (existing?.config as Record<string, unknown> | null) ?? {};
	const config = {
		// Én fast enhets-id per tilkobling, som en installert app.
		deviceId: typeof previous.deviceId === 'string' ? previous.deviceId : randomUUID(),
		mobileNumber
	};

	if (existing) {
		await db
			.update(sensors)
			.set({ credentials, config, isActive: true, lastError: null, updatedAt: new Date() })
			.where(eq(sensors.id, existing.id));
		return existing.id;
	}
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: REMA_PROVIDER,
			type: 'purchase_history',
			subtype: 'grocery',
			name: 'Rema 1000',
			credentials,
			config,
			isActive: true
		})
		.returning({ id: sensors.id });
	return created.id;
}
