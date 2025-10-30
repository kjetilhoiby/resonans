import { WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET } from '$env/static/private';

export interface WithingsTokenResponse {
	status: number;
	body: {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		userid: string;
		scope: string;
	};
	error?: string;
}

export interface WithingsMeasureResponse {
	status: number;
	body: {
		updatetime: number;
		timezone: string;
		measuregrps?: Array<{
			grpid: number;
			attrib: number;
			date: number;
			created: number;
			category: number;
			deviceid: string;
			measures: Array<{
				value: number;
				type: number;
				unit: number;
			}>;
		}>;
		activities?: Array<any>;
		series?: Array<any>;
		more?: boolean;
		offset?: number;
	};
	error?: string;
}

/**
 * Generate Withings OAuth URL for user authorization
 */
export function getWithingsAuthUrl(redirectUri: string, state?: string): string {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: WITHINGS_CLIENT_ID,
		scope: 'user.metrics,user.activity',
		redirect_uri: redirectUri,
		state: state || crypto.randomUUID()
	});

	return `https://account.withings.com/oauth2_user/authorize2?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function getAccessToken(
	code: string,
	redirectUri: string
): Promise<WithingsTokenResponse> {
	const formData = new URLSearchParams({
		action: 'requesttoken',
		grant_type: 'authorization_code',
		client_id: WITHINGS_CLIENT_ID,
		client_secret: WITHINGS_CLIENT_SECRET,
		code,
		redirect_uri: redirectUri
	});

	const response = await fetch('https://wbsapi.withings.net/v2/oauth2', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: formData
	});

	return response.json();
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<WithingsTokenResponse> {
	const formData = new URLSearchParams({
		action: 'requesttoken',
		grant_type: 'refresh_token',
		client_id: WITHINGS_CLIENT_ID,
		client_secret: WITHINGS_CLIENT_SECRET,
		refresh_token: refreshToken
	});

	const response = await fetch('https://wbsapi.withings.net/v2/oauth2', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: formData
	});

	return response.json();
}

/**
 * Fetch measurements from Withings API with pagination support
 */
export async function fetchWithingsMeasurements(
	accessToken: string,
	params: {
		action: 'getmeas' | 'getactivity' | 'getsummary' | 'getworkouts';
		meastype?: number; // 1=weight, 11=pulse, 54=spo2, etc.
		category?: number; // 1=real measurements
		startdate?: number; // Unix timestamp
		enddate?: number; // Unix timestamp
		startdateymd?: string; // YYYY-MM-DD
		enddateymd?: string; // YYYY-MM-DD
		offset?: number;
		lastupdate?: number; // Unix timestamp for incremental sync
		data_fields?: string; // Comma-separated fields for workouts (e.g., 'steps,distance,calories')
	}
): Promise<WithingsMeasureResponse> {
	const endpoint = params.action.includes('activity') || params.action.includes('summary') || params.action.includes('workouts')
		? 'https://wbsapi.withings.net/v2/measure'
		: 'https://wbsapi.withings.net/measure';

	// Clean undefined values
	const cleanParams = Object.fromEntries(
		Object.entries(params).filter(([_, v]) => v !== undefined)
	);

	const formData = new URLSearchParams(cleanParams as Record<string, string>);

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: formData
	});

	return response.json();
}

/**
 * Fetch sleep data from Withings API
 */
export async function fetchWithingsSleep(
	accessToken: string,
	params: {
		action: 'get' | 'getsummary';
		startdateymd?: string;
		enddateymd?: string;
		startdate?: number;
		enddate?: number;
		offset?: number;
		lastupdate?: number;
	}
): Promise<WithingsMeasureResponse> {
	const cleanParams = Object.fromEntries(
		Object.entries(params).filter(([_, v]) => v !== undefined)
	);

	const formData = new URLSearchParams(cleanParams as Record<string, string>);

	const response = await fetch('https://wbsapi.withings.net/v2/sleep', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: formData
	});

	return response.json();
}

/**
 * Fetch all paginated results from Withings API
 */
export async function fetchAllWithingsData(
	accessToken: string,
	params: Parameters<typeof fetchWithingsMeasurements>[1],
	onProgress?: (page: number, total: number) => void
): Promise<any[]> {
	const allData: any[] = [];
	let offset = 0;
	let hasMore = true;
	let page = 0;

	while (hasMore) {
		page++;
		const response = await fetchWithingsMeasurements(accessToken, {
			...params,
			offset
		});

		if (response.status !== 0) {
			throw new Error(`Withings API error: ${response.error || 'Unknown error'}`);
		}

		const dataKey = params.action === 'getmeas' ? 'measuregrps' :
			params.action === 'getactivity' ? 'activities' :
				params.action === 'getworkouts' ? 'series' : 'series';

		const batch = response.body[dataKey as keyof typeof response.body] || [];
		allData.push(...(Array.isArray(batch) ? batch : []));

		hasMore = response.body.more || false;
		offset = response.body.offset || 0;

		if (onProgress) {
			onProgress(page, allData.length);
		}

		// Safety: max 100 pages
		if (page >= 100) {
			console.warn('Withings sync stopped at 100 pages');
			break;
		}
	}

	return allData;
}
