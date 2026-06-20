import { env } from '$env/dynamic/private';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Tynn klient mot Tesla Fleet API (offisiell, post-2024). All token-håndtering
 * skjer server-side; client_secret forlater aldri serveren.
 *
 * Read-only i v1: vi henter `vehicle_data` (lading, posisjon, klima, km-stand),
 * men sender ingen kommandoer. Kommandoer ville krevd Vehicle Command Protocol
 * med signerte forespørsler og en virtuell nøkkel paret til bilen.
 *
 * Oppsett utenfor koden (engangs):
 *  - Utviklerapp på developer.tesla.com → TESLA_CLIENT_ID / TESLA_CLIENT_SECRET.
 *  - Partner-registrering: POST {base}/api/1/partner_accounts med domenet vårt.
 *    Tesla henter public-key fra
 *    https://<domene>/.well-known/appspecific/com.tesla.3p.public-key.pem
 *    (ligger som statisk fil i static/.well-known/...).
 *  - Region: etter token kaller vi /api/1/users/region for å finne riktig
 *    fleet_api_base_url (NA vs EU). Caches per tilkobling i sensors.config.
 */

const CLIENT_ID = env.TESLA_CLIENT_ID ?? '';
const CLIENT_SECRET = env.TESLA_CLIENT_SECRET ?? '';

const AUTH_BASE = 'https://auth.tesla.com/oauth2/v3';
// EU-region som standard (norsk bruker). Region-endepunktet gir oss den
// faktiske base-URL-en etter innlogging; denne brukes kun til token-audience
// og som fallback hvis region-oppslaget feiler.
const DEFAULT_FLEET_BASE_URL =
	env.TESLA_FLEET_BASE_URL ?? 'https://fleet-api.prd.eu.vn.cloud.tesla.com';

// Read-only scopes. vehicle_location er en egen scope som kreves for GPS.
export const TESLA_SCOPES = 'openid offline_access vehicle_device_data vehicle_location';

const DEFAULT_TIMEOUT_MS = 15_000;

export function isTeslaConfigured(): boolean {
	return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export class TeslaApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'TeslaApiError';
		this.status = status;
	}
}

export interface TeslaTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number; // sekunder
	token_type: string;
	id_token?: string;
	scope?: string;
	state?: string;
}

export interface TeslaVehicleSummary {
	id: number; // numerisk vehicle id
	vehicle_id: number;
	vin: string;
	display_name: string | null;
	state: string; // 'online' | 'asleep' | 'offline'
}

async function teslaFetch(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...rest, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

// ── PKCE ───────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
	verifier: string;
	challenge: string;
}

/**
 * Genererer et PKCE-par. `verifier` er en tilfeldig høyentropi-streng (lagres i
 * httpOnly-cookie til callback), `challenge` = base64url(sha256(verifier)) som
 * sendes i authorize-URL-en.
 */
export function generatePkcePair(): PkcePair {
	const verifier = base64url(randomBytes(48)); // 64 tegn etter base64url
	const challenge = base64url(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export function getAuthorizeUrl(opts: {
	redirectUri: string;
	state: string;
	codeChallenge: string;
	scope?: string;
}): string {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: opts.redirectUri,
		scope: opts.scope ?? TESLA_SCOPES,
		state: opts.state,
		code_challenge: opts.codeChallenge,
		code_challenge_method: 'S256'
	});
	return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<TeslaTokenResponse> {
	const res = await teslaFetch(`${AUTH_BASE}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new TeslaApiError(`Tesla token-endepunkt ${res.status}: ${text}`, res.status);
	}
	return res.json();
}

export function exchangeCodeForToken(opts: {
	code: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<TeslaTokenResponse> {
	return postToken({
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		code: opts.code,
		redirect_uri: opts.redirectUri,
		code_verifier: opts.codeVerifier,
		audience: DEFAULT_FLEET_BASE_URL
	});
}

export function refreshAccessToken(refreshToken: string): Promise<TeslaTokenResponse> {
	return postToken({
		grant_type: 'refresh_token',
		client_id: CLIENT_ID,
		refresh_token: refreshToken
	});
}

// ── Fleet API ─────────────────────────────────────────────────────────────────

/**
 * Finn brukerens region og riktige fleet_api_base_url. Kan kalles mot en
 * vilkårlig base; svaret peker på den korrekte regionale base-URL-en.
 */
export async function getRegion(
	accessToken: string,
	baseUrl: string = DEFAULT_FLEET_BASE_URL
): Promise<{ region: string; fleetApiBaseUrl: string }> {
	const res = await teslaFetch(`${baseUrl}/api/1/users/region`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new TeslaApiError(`Tesla region-oppslag ${res.status}: ${text}`, res.status);
	}
	const body = (await res.json()) as {
		response?: { region?: string; fleet_api_base_url?: string };
	};
	return {
		region: body.response?.region ?? 'unknown',
		fleetApiBaseUrl: body.response?.fleet_api_base_url ?? baseUrl
	};
}

export async function listVehicles(
	accessToken: string,
	baseUrl: string
): Promise<TeslaVehicleSummary[]> {
	const res = await teslaFetch(`${baseUrl}/api/1/vehicles`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (res.status === 401 || res.status === 403) {
		throw new TeslaApiError('Tesla avviste forespørsel (mangler tilgang)', res.status);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new TeslaApiError(`Tesla /vehicles ${res.status}: ${text}`, res.status);
	}
	const body = (await res.json()) as { response?: TeslaVehicleSummary[] };
	return body.response ?? [];
}

export type VehicleDataResult =
	| { ok: true; data: Record<string, any> }
	| { ok: false; asleep: true };

/**
 * Hent vehicle_data for ett kjøretøy. Vekker IKKE bilen — hvis den sover svarer
 * Fleet API 408, og vi returnerer `{ ok: false, asleep: true }` slik at synk-
 * jobben kan logge en vellykket (men tom) kjøring uten å markere feil.
 */
export async function getVehicleData(
	accessToken: string,
	baseUrl: string,
	vehicleTag: string | number
): Promise<VehicleDataResult> {
	const endpoints = 'charge_state;drive_state;vehicle_state;climate_state;location_data';
	const url = `${baseUrl}/api/1/vehicles/${vehicleTag}/vehicle_data?endpoints=${encodeURIComponent(endpoints)}`;
	const res = await teslaFetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	// 408 = bilen sover / er offline. Ikke en reell feil for en poll-jobb.
	if (res.status === 408) {
		return { ok: false, asleep: true };
	}
	if (res.status === 401 || res.status === 403) {
		throw new TeslaApiError('Tesla avviste forespørsel (mangler tilgang)', res.status);
	}
	if (res.status === 429) {
		throw new TeslaApiError('Tesla rate limit', 429);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new TeslaApiError(`Tesla vehicle_data ${res.status}: ${text}`, res.status);
	}
	const body = (await res.json()) as { response?: Record<string, any> };
	if (!body.response) {
		return { ok: false, asleep: true };
	}
	return { ok: true, data: body.response };
}

export type NearbyChargersResult =
	| { ok: true; data: Record<string, any> }
	| { ok: false; asleep: true };

/**
 * Hent ladere nær bilens nåværende posisjon (superchargere med live stall-
 * tilgjengelighet + destination chargers). Krever bil online — sover den svarer
 * Fleet API 408 og vi returnerer `{ ok: false, asleep: true }`. Dekkes av
 * `vehicle_device_data`-scope (samme som vehicle_data); ingen ny tilgang trengs.
 */
export async function getNearbyChargers(
	accessToken: string,
	baseUrl: string,
	vehicleTag: string | number
): Promise<NearbyChargersResult> {
	const url = `${baseUrl}/api/1/vehicles/${vehicleTag}/nearby_charging_sites`;
	const res = await teslaFetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (res.status === 408) {
		return { ok: false, asleep: true };
	}
	if (res.status === 401 || res.status === 403) {
		throw new TeslaApiError('Tesla avviste forespørsel (mangler tilgang)', res.status);
	}
	if (res.status === 429) {
		throw new TeslaApiError('Tesla rate limit', 429);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new TeslaApiError(`Tesla nearby_charging_sites ${res.status}: ${text}`, res.status);
	}
	const body = (await res.json()) as { response?: Record<string, any> };
	if (!body.response) {
		return { ok: false, asleep: true };
	}
	return { ok: true, data: body.response };
}
