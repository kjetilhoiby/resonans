import { env } from '$env/dynamic/private';

export interface DropboxTokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
	account_id?: string;
	uid?: string;
}

export interface DropboxListFolderEntry {
	'.tag': 'file' | 'folder' | string;
	id: string;
	name: string;
	path_lower?: string;
	path_display?: string;
	client_modified?: string;
	server_modified?: string;
	rev?: string;
	size?: number;
}

interface ListFolderResponse {
	entries: DropboxListFolderEntry[];
	cursor: string;
	has_more: boolean;
}

interface ListDropboxFolderOptions {
	recursive?: boolean;
	limit?: number;
}

async function readDropboxResponse(response: Response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function stringifyDropboxPayload(payload: unknown): string {
	if (typeof payload === 'string') return payload;
	try {
		return JSON.stringify(payload);
	} catch {
		return String(payload);
	}
}

function getRequiredEnv(name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function api(url: string, accessToken: string, body?: unknown) {
	return fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	});
}

export function getDropboxAuthUrl(redirectUri: string, state: string): string {
	const clientId = getRequiredEnv('DROPBOX_CLIENT_ID');
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: 'code',
		redirect_uri: redirectUri,
		state,
		token_access_type: 'offline',
		scope: 'account_info.read files.metadata.read files.content.read'
	});
	return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

export async function getDropboxAccessToken(code: string, redirectUri: string): Promise<DropboxTokenResponse> {
	const clientId = getRequiredEnv('DROPBOX_CLIENT_ID');
	const clientSecret = getRequiredEnv('DROPBOX_CLIENT_SECRET');

	const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			code,
			grant_type: 'authorization_code',
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri
		})
	});

	const payload = await readDropboxResponse(response);
	if (!response.ok) {
		throw new Error(`Dropbox token exchange failed: ${stringifyDropboxPayload(payload)}`);
	}

	return payload as DropboxTokenResponse;
}

export async function refreshDropboxAccessToken(refreshToken: string): Promise<DropboxTokenResponse> {
	const clientId = getRequiredEnv('DROPBOX_CLIENT_ID');
	const clientSecret = getRequiredEnv('DROPBOX_CLIENT_SECRET');

	const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
			client_id: clientId,
			client_secret: clientSecret
		})
	});

	const payload = await readDropboxResponse(response);
	if (!response.ok) {
		throw new Error(`Dropbox token refresh failed: ${stringifyDropboxPayload(payload)}`);
	}

	return payload as DropboxTokenResponse;
}

export async function listDropboxFolder(
	accessToken: string,
	path = '',
	options: ListDropboxFolderOptions = {}
): Promise<ListFolderResponse> {
	const response = await api('https://api.dropboxapi.com/2/files/list_folder', accessToken, {
		path,
		recursive: options.recursive ?? false,
		include_deleted: false,
		include_non_downloadable_files: false,
		limit: options.limit ?? 200
	});

	const payload = await readDropboxResponse(response);
	if (!response.ok) {
		throw new Error(`Dropbox list_folder failed: ${stringifyDropboxPayload(payload)}`);
	}

	return payload as ListFolderResponse;
}

export async function continueDropboxFolder(accessToken: string, cursor: string): Promise<ListFolderResponse> {
	const response = await api('https://api.dropboxapi.com/2/files/list_folder/continue', accessToken, {
		cursor
	});

	const payload = await readDropboxResponse(response);
	if (!response.ok) {
		throw new Error(`Dropbox list_folder/continue failed: ${stringifyDropboxPayload(payload)}`);
	}

	return payload as ListFolderResponse;
}

export async function downloadDropboxFile(accessToken: string, path: string): Promise<string> {
	const response = await fetch('https://content.dropboxapi.com/2/files/download', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Dropbox-API-Arg': JSON.stringify({ path })
		}
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Dropbox download failed: ${response.status} ${body}`);
	}

	return response.text();
}
