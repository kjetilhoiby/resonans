import { env } from '$env/dynamic/private';

export interface GoogleTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope: string;
	token_type: string;
}

export interface GoogleSheetValue {
	range: string;
	majorDimension: string;
	values: string[][];
}

export interface SpreadsheetMeta {
	spreadsheetId: string;
	properties: {
		title: string;
		locale: string;
		timeZone: string;
	};
	sheets: Array<{
		properties: {
			sheetId: number;
			title: string;
			index: number;
		};
	}>;
}

function getRequiredEnv(name: string): string {
	const value = env[name];
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

export function getGoogleSheetsAuthUrl(redirectUri: string, state: string): string {
	const clientId = getRequiredEnv('GOOGLE_SHEETS_CLIENT_ID');

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: [
			'https://www.googleapis.com/auth/spreadsheets.readonly',
			'https://www.googleapis.com/auth/drive.metadata.readonly'
		].join(' '),
		access_type: 'offline',
		prompt: 'consent',
		state
	});

	return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function getGoogleSheetsAccessToken(
	code: string,
	redirectUri: string
): Promise<GoogleTokenResponse> {
	const clientId = getRequiredEnv('GOOGLE_SHEETS_CLIENT_ID');
	const clientSecret = getRequiredEnv('GOOGLE_SHEETS_CLIENT_SECRET');

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google token exchange failed: ${response.status} ${body}`);
	}

	return response.json();
}

export async function refreshGoogleSheetsToken(refreshToken: string): Promise<GoogleTokenResponse> {
	const clientId = getRequiredEnv('GOOGLE_SHEETS_CLIENT_ID');
	const clientSecret = getRequiredEnv('GOOGLE_SHEETS_CLIENT_SECRET');

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token'
		})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google token refresh failed: ${response.status} ${body}`);
	}

	return response.json();
}

export async function readGoogleSheet(
	accessToken: string,
	spreadsheetId: string,
	range = ''
): Promise<GoogleSheetValue> {
	const cleanId = spreadsheetId.trim();
	const encodedRange = range ? `/${encodeURIComponent(range)}` : '/A1:ZZ10000';
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values${encodedRange}?majorDimension=ROWS`;

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google Sheets read failed: ${response.status} ${body}`);
	}

	return response.json();
}

export async function getSpreadsheetMeta(
	accessToken: string,
	spreadsheetId: string
): Promise<SpreadsheetMeta> {
	const cleanId = spreadsheetId.trim();
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=spreadsheetId,properties,sheets.properties`;

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google Sheets meta failed: ${response.status} ${body}`);
	}

	return response.json();
}
