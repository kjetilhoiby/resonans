import { env } from '$env/dynamic/private';

export interface Sparebank1TokenResponse {
	access_token?: string;
	token_type?: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
	state?: string | number;
	[key: string]: any;
}

const DEFAULT_BASE_URL = 'https://api.sparebank1.no';
const DEFAULT_ACCEPT_HEADER = 'application/vnd.sparebank1.v1+json; charset=utf-8';

function getRequiredEnv(name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function getBaseUrl(): string {
	return env.SPAREBANK1_API_BASE_URL || DEFAULT_BASE_URL;
}

function getUrl(pathOrUrl: string): string {
	if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
		return pathOrUrl;
	}

	const base = getBaseUrl();
	const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
	return `${base}${path}`;
}

function parseArrayResponse(payload: any): any[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload?.accounts)) return payload.accounts;
	if (Array.isArray(payload?.items)) return payload.items;
	if (Array.isArray(payload?.transactions)) return payload.transactions;
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

export function getSparebank1AuthUrl(redirectUri: string, state: string): string {
	const clientId = getRequiredEnv('SPAREBANK1_CLIENT_ID');
	const financialInstitution = env.SPAREBANK1_FINANCIAL_INSTITUTION || 'fid-smn';
	const scopes = env.SPAREBANK1_SCOPES || '';
	const authorizeEndpoint = getUrl(env.SPAREBANK1_AUTHORIZE_ENDPOINT || '/oauth/authorize');

	const params = new URLSearchParams({
		client_id: clientId,
		state,
		redirect_uri: redirectUri,
		finInst: financialInstitution,
		response_type: 'code'
	});

	if (scopes) {
		params.set('scope', scopes);
	}

	return `${authorizeEndpoint}?${params.toString()}`;
}

export async function getSparebank1AccessToken(
	code: string,
	redirectUri: string,
	state?: string
): Promise<Sparebank1TokenResponse> {
	const clientId = getRequiredEnv('SPAREBANK1_CLIENT_ID');
	const clientSecret = getRequiredEnv('SPAREBANK1_CLIENT_SECRET');
	const tokenEndpoint = getUrl(env.SPAREBANK1_TOKEN_ENDPOINT || '/oauth/token');

	const formData = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		code,
		grant_type: 'authorization_code',
		redirect_uri: redirectUri
	});

	if (state) {
		formData.set('state', state);
	}

	const response = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body: formData
	});

	const body = await response.json();

	if (!response.ok) {
		throw new Error(`SpareBank1 token exchange failed: ${JSON.stringify(body)}`);
	}

	return body;
}

export async function refreshSparebank1AccessToken(
	refreshToken: string
): Promise<Sparebank1TokenResponse> {
	const clientId = getRequiredEnv('SPAREBANK1_CLIENT_ID');
	const clientSecret = getRequiredEnv('SPAREBANK1_CLIENT_SECRET');
	const tokenEndpoint = getUrl(env.SPAREBANK1_TOKEN_ENDPOINT || '/oauth/token');

	const formData = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
		grant_type: 'refresh_token'
	});

	const response = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body: formData
	});

	const body = await response.json();

	if (!response.ok) {
		throw new Error(`SpareBank1 refresh failed: ${JSON.stringify(body)}`);
	}

	return body;
}

async function fetchWithRetry(url: string, options: RequestInit, label: string): Promise<Response> {
	const maxRetries = 3;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const response = await fetch(url, options);
		if (response.status === 429) {
			if (attempt === maxRetries - 1) {
				throw new Error(`${label} failed: ${response.status}`);
			}
			const retryAfter = response.headers.get('Retry-After');
			const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 2000;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			continue;
		}
		return response;
	}
	throw new Error(`${label} failed: max retries exceeded`);
}

export async function fetchSparebank1HelloWorld(accessToken: string): Promise<any> {
	const helloEndpoint = getUrl(env.SPAREBANK1_HELLOWORLD_ENDPOINT || '/common/helloworld');

	const response = await fetchWithRetry(
		helloEndpoint,
		{ headers: { Authorization: `Bearer ${accessToken}`, Accept: DEFAULT_ACCEPT_HEADER } },
		'SpareBank1 hello world'
	);

	if (!response.ok) {
		throw new Error(`SpareBank1 hello world failed: ${response.status}`);
	}

	return response.json();
}

export async function fetchSparebank1Accounts(accessToken: string): Promise<any[]> {
	const endpoint = env.SPAREBANK1_ACCOUNTS_ENDPOINT || '/personal/banking/accounts';

	const response = await fetchWithRetry(
		getUrl(endpoint),
		{ headers: { Authorization: `Bearer ${accessToken}`, Accept: DEFAULT_ACCEPT_HEADER } },
		'SpareBank1 accounts fetch'
	);

	if (!response.ok) {
		throw new Error(`SpareBank1 accounts fetch failed: ${response.status}`);
	}

	return parseArrayResponse(await response.json());
}

export async function fetchSparebank1Transactions(
	accessToken: string,
	accountKey?: string,
	since?: Date,
	toDate?: Date
): Promise<any[]> {
	const endpoint = env.SPAREBANK1_TRANSACTIONS_ENDPOINT || '/personal/banking/transactions';

	const url = new URL(getUrl(endpoint));
	if (accountKey) {
		url.searchParams.set('accountKey', accountKey);
	}
	if (since) {
		url.searchParams.set('fromDate', since.toISOString().split('T')[0]);
	}
	if (toDate) {
		url.searchParams.set('toDate', toDate.toISOString().split('T')[0]);
	}

	const response = await fetchWithRetry(
		url.toString(),
		{ headers: { Authorization: `Bearer ${accessToken}`, Accept: DEFAULT_ACCEPT_HEADER } },
		'SpareBank1 transactions fetch'
	);

	if (!response.ok) {
		throw new Error(`SpareBank1 transactions fetch failed: ${response.status}`);
	}

	return parseArrayResponse(await response.json());
}
