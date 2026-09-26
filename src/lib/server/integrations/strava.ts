import { env } from '$env/dynamic/private';

/**
 * Tynn klient mot Strava OAuth + Uploads API. All token-håndtering skjer
 * server-side; client_secret forlater aldri serveren. Se docs/STRAVA_SYNC_SPEC.
 */

const CLIENT_ID = env.STRAVA_CLIENT_ID ?? '';
const CLIENT_SECRET = env.STRAVA_CLIENT_SECRET ?? '';
const OAUTH_BASE = 'https://www.strava.com/oauth';
const API_BASE = 'https://www.strava.com/api/v3';

export function isStravaConfigured(): boolean {
	return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export class StravaApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'StravaApiError';
		this.status = status;
	}
}

export interface StravaAthlete {
	id: number;
	firstname?: string;
	lastname?: string;
	username?: string;
}

export interface StravaTokenResponse {
	token_type: string;
	access_token: string;
	refresh_token: string;
	expires_at: number; // epoch-sekunder
	expires_in: number;
	scope?: string;
	athlete?: StravaAthlete;
}

export interface StravaUploadResponse {
	id: number;
	id_str?: string;
	external_id?: string | null;
	error: string | null;
	status: string;
	activity_id: number | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function stravaFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...rest, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export function getAuthorizeUrl(opts: { redirectUri: string; state: string; scope?: string }): string {
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		response_type: 'code',
		redirect_uri: opts.redirectUri,
		approval_prompt: 'auto',
		scope: opts.scope ?? 'activity:write,read',
		state: opts.state
	});
	return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<StravaTokenResponse> {
	const res = await stravaFetch(`${OAUTH_BASE}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new StravaApiError(`Strava token-endepunkt ${res.status}: ${text}`, res.status);
	}
	return res.json();
}

export function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
	return postToken({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		code,
		grant_type: 'authorization_code'
	});
}

export function refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
	return postToken({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		grant_type: 'refresh_token',
		refresh_token: refreshToken
	});
}

export async function deauthorize(accessToken: string): Promise<void> {
	// Best effort — vi sletter uansett tokens lokalt etterpå.
	try {
		await stravaFetch(`${OAUTH_BASE}/deauthorize`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}` }
		});
	} catch (err) {
		console.warn('Strava deauthorize feilet (ignorert):', err);
	}
}

/** Øktfilen slik den ble lastet opp til Resonans. Strava tar begge formatene rett inn. */
export interface StravaActivityFile {
	content: string;
	format: 'gpx' | 'tcx';
}

const FILE_MIME: Record<StravaActivityFile['format'], string> = {
	gpx: 'application/gpx+xml',
	tcx: 'application/vnd.garmin.tcx+xml'
};

export async function uploadActivity(
	accessToken: string,
	opts: {
		file: StravaActivityFile;
		externalId: string;
		name?: string;
		sportType?: string;
		/**
		 * Innendørs (mølle, sykkelrulle). Strava merker økta og viser ikke kart —
		 * uten flagget blir en TCX uten posisjoner en løpetur som «mangler GPS».
		 */
		trainer?: boolean;
	}
): Promise<StravaUploadResponse> {
	const form = new FormData();
	form.append('data_type', opts.file.format);
	form.append('external_id', opts.externalId);
	if (opts.name) form.append('name', opts.name);
	if (opts.sportType) form.append('sport_type', opts.sportType);
	if (opts.trainer) form.append('trainer', '1');
	// Strava avviser en TCX med blanktegn før XML-deklarasjonen («Error parsing file»),
	// så det kuttes her i stedet for å stole på hver klient.
	form.append(
		'file',
		new Blob([opts.file.content.trimStart()], { type: FILE_MIME[opts.file.format] }),
		`${opts.externalId}.${opts.file.format}`
	);

	const res = await stravaFetch(`${API_BASE}/uploads`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${accessToken}` },
		body: form
	});

	const json = (await res.json().catch(() => ({}))) as Partial<StravaUploadResponse> & { message?: string };

	if (res.status === 401 || res.status === 403) {
		throw new StravaApiError('Strava avviste opplasting (mangler tilgang)', res.status);
	}
	if (res.status === 429) {
		throw new StravaApiError('Strava rate limit', 429);
	}
	// En duplikat-opplasting kan komme som 400 med "duplicate"-melding ELLER som
	// 201 med error-feltet satt. Begge håndteres av kalleren via error-feltet.
	if (!res.ok && typeof json.id !== 'number') {
		const detail = json.message || json.error || `status ${res.status}`;
		throw new StravaApiError(`Strava-opplasting feilet: ${detail}`, res.status);
	}

	return json as StravaUploadResponse;
}

export async function getUpload(accessToken: string, uploadId: number): Promise<StravaUploadResponse> {
	const res = await stravaFetch(`${API_BASE}/uploads/${uploadId}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (res.status === 401 || res.status === 403) {
		throw new StravaApiError('Strava avviste poll (mangler tilgang)', res.status);
	}
	if (res.status === 429) {
		throw new StravaApiError('Strava rate limit', 429);
	}
	return res.json();
}

// ekko-sportType (etter normalizeSportType) → Strava sport_type.
const SPORT_MAP: Record<string, string> = {
	running: 'Run',
	indoor_running: 'Run',
	cycling: 'Ride',
	indoor_cycling: 'Ride',
	e_bike: 'EBikeRide',
	walking: 'Walk',
	indoor_walking: 'Walk',
	hiking: 'Hike',
	trail: 'TrailRun',
	// Strava har ingen «hill»-type — bakkedrag er en løpeøkt der stigningen ligger i GPX-en.
	hill: 'Run',
	swimming: 'Swim'
};

/** Er dette en innendørsøkt? Da skal den til Strava som `trainer`. */
export function isIndoorSportType(sportType: string | null | undefined): boolean {
	return (sportType ?? '').trim().toLowerCase().startsWith('indoor_');
}

export function mapSportType(sportType: string | null | undefined): string | undefined {
	if (!sportType) return undefined;
	return SPORT_MAP[sportType.trim().toLowerCase()];
}
