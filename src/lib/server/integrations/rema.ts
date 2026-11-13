/**
 * Rema 1000 (Æ) — HTTP-klienten.
 *
 * API-et er Æ-appens eget og uoffisielt (kontrakten er lest ut av appen av
 * tredjepart, se `docs/changelog/2026-11-13-rema-kvitteringer.md`). Det kan
 * endre seg uten varsel, så:
 *
 *  - Alt svar valideres felt for felt i `$lib/domains/food/rema-receipts.ts`.
 *  - Feil bærer HTTP-statusen som et felt (`RemaHttpError.status`), ikke i
 *    meldingsteksten, så tokenlaget kan skille en 401 fra alt annet.
 *  - Vi kaller bare de to lese-endepunktene for kvitteringer. Ingen skriving,
 *    ingen tilbud, ingen profil.
 *
 * Abonnementsnøkkelen til Remas API-gateway (`ocp-apim-subscription-key`)
 * ligger i miljøet, ikke i koden: den er appens, ikke vår, og repoet er åpent.
 */

import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import {
	REMA_CLIENT_ID,
	REMA_REDIRECT_URI,
	REMA_TOKEN_URL
} from '$lib/domains/food/rema-receipts';

const API_BASE = 'https://api.rema.no';
/** Versjonen gisten ble lest ut av. Kan overstyres når appen går videre. */
const DEFAULT_APP_VERSION = '3.0.12 #110549';
const REQUEST_TIMEOUT_MS = 20_000;

export class RemaHttpError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'RemaHttpError';
	}
}

export class RemaNotConfiguredError extends Error {
	constructor() {
		super(
			'REMA_APIM_SUBSCRIPTION_KEY er ikke satt. Rema-API-et krever Æ-appens abonnementsnøkkel i miljøet.'
		);
		this.name = 'RemaNotConfiguredError';
	}
}

export function remaSubscriptionKey(): string {
	const key = env.REMA_APIM_SUBSCRIPTION_KEY?.trim();
	if (!key) throw new RemaNotConfiguredError();
	return key;
}

export function isRemaConfigured(): boolean {
	return Boolean(env.REMA_APIM_SUBSCRIPTION_KEY?.trim());
}

export interface RemaTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

/** Kort, lesbar feiltekst — HTML-feilsider kappes, tokens skal aldri med. */
async function describeFailure(res: Response): Promise<string> {
	const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim();
	return body.slice(0, 300) || res.statusText || 'ingen tekst';
}

async function postToken(form: Record<string, string>): Promise<RemaTokenResponse> {
	const res = await fetch(REMA_TOKEN_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'application/json'
		},
		body: new URLSearchParams(form).toString(),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!res.ok) {
		throw new RemaHttpError(`Rema token ${res.status}: ${await describeFailure(res)}`, res.status);
	}
	const payload = (await res.json()) as Partial<RemaTokenResponse>;
	if (!payload.access_token) {
		throw new RemaHttpError('Rema token: svaret manglet access_token', res.status);
	}
	return payload as RemaTokenResponse;
}

export function exchangeRemaCode(code: string, codeVerifier: string): Promise<RemaTokenResponse> {
	return postToken({
		grant_type: 'authorization_code',
		code,
		redirect_uri: REMA_REDIRECT_URI,
		client_id: REMA_CLIENT_ID,
		code_verifier: codeVerifier
	});
}

export function refreshRemaToken(refreshToken: string): Promise<RemaTokenResponse> {
	return postToken({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: REMA_CLIENT_ID
	});
}

export interface RemaDeviceContext {
	/** Fast per tilkobling, som en installert app. Lagres i sensor-config. */
	deviceId: string;
	/** Appen sender mobilnummeret i en header. Valgfritt hos oss. */
	mobileNumber?: string | null;
}

async function getJson(path: string, accessToken: string, device: RemaDeviceContext): Promise<unknown> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${accessToken}`,
		accept: 'application/json',
		'ocp-apim-subscription-key': remaSubscriptionKey(),
		'x-platform': 'android',
		'x-app': 'bella',
		'x-app-version': env.REMA_APP_VERSION?.trim() || DEFAULT_APP_VERSION,
		'x-correlation-id': randomUUID(),
		'x-device-id': device.deviceId
	};
	if (device.mobileNumber) headers['x-mobile-nr'] = device.mobileNumber;

	const res = await fetch(`${API_BASE}${path}`, {
		headers,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!res.ok) {
		throw new RemaHttpError(`Rema ${path.split('/').slice(0, 6).join('/')} ${res.status}: ${await describeFailure(res)}`, res.status);
	}
	return res.json();
}

export function fetchRemaTransactionHeads(accessToken: string, device: RemaDeviceContext) {
	return getJson('/v1/bella/transaction/v2/heads', accessToken, device);
}

export function fetchRemaTransactionRows(
	accessToken: string,
	device: RemaDeviceContext,
	transactionId: string
) {
	if (!/^\d+$/.test(transactionId)) throw new Error(`Ugyldig transaksjons-id: ${transactionId}`);
	return getJson(`/v1/bella/transaction/v2/rows/${transactionId}`, accessToken, device);
}
