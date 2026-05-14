import { env } from '$env/dynamic/private';

const STRAVA_CLIENT_ID = env.STRAVA_CLIENT_ID || '';
const STRAVA_CLIENT_SECRET = env.STRAVA_CLIENT_SECRET || '';

export interface StravaTokenResponse {
	token_type: string;
	expires_at: number;
	expires_in: number;
	refresh_token: string;
	access_token: string;
	athlete: {
		id: number;
		firstname: string;
		lastname: string;
	};
}

export interface StravaActivity {
	id: number;
	name: string;
	type: string;
	sport_type: string;
	start_date: string;
	start_date_local: string;
	elapsed_time: number;
	moving_time: number;
	distance: number;
	total_elevation_gain: number;
	elev_high: number;
	elev_low: number;
	average_speed: number;
	max_speed: number;
	average_heartrate?: number;
	max_heartrate?: number;
	average_cadence?: number;
	average_watts?: number;
	kilojoules?: number;
	calories?: number;
	has_heartrate: boolean;
	map?: {
		id: string;
		summary_polyline: string;
		polyline?: string;
	};
	gear_id?: string;
	device_name?: string;
}

export interface StravaStream {
	type: string;
	data: number[];
	series_type: string;
	original_size: number;
	resolution: string;
}

export function getStravaAuthUrl(redirectUri: string, state: string): string {
	const params = new URLSearchParams({
		client_id: STRAVA_CLIENT_ID,
		response_type: 'code',
		redirect_uri: redirectUri,
		approval_prompt: 'auto',
		scope: 'read,activity:read_all',
		state
	});
	return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function getStravaAccessToken(code: string): Promise<StravaTokenResponse> {
	const response = await fetch('https://www.strava.com/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: STRAVA_CLIENT_ID,
			client_secret: STRAVA_CLIENT_SECRET,
			code,
			grant_type: 'authorization_code'
		})
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Strava token exchange failed: ${text}`);
	}
	return response.json();
}

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
	const response = await fetch('https://www.strava.com/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: STRAVA_CLIENT_ID,
			client_secret: STRAVA_CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Strava token refresh failed: ${text}`);
	}
	return response.json();
}

export async function fetchStravaActivities(
	accessToken: string,
	after?: number,
	page = 1,
	perPage = 100
): Promise<StravaActivity[]> {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage)
	});
	if (after) params.set('after', String(after));

	const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Strava activities fetch failed: ${text}`);
	}
	return response.json();
}

export async function fetchStravaActivityStreams(
	accessToken: string,
	activityId: number,
	streamTypes: string[] = ['latlng', 'altitude', 'heartrate', 'time']
): Promise<StravaStream[]> {
	const keys = streamTypes.join(',');
	const response = await fetch(
		`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_type=time`,
		{ headers: { Authorization: `Bearer ${accessToken}` } }
	);

	if (!response.ok) {
		if (response.status === 404) return [];
		const text = await response.text();
		throw new Error(`Strava streams fetch failed: ${text}`);
	}
	return response.json();
}
