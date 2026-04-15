const SPOND_API_BASE = 'https://api.spond.com/core/v1/';
const DT_FORMAT = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z');

export interface SpondEvent {
	id: string;
	heading: string;
	description?: string;
	startTimestamp: string; // ISO 8601
	endTimestamp: string;
	cancelled?: boolean;
	type?: string;
	location?: {
		feature?: string;
		address?: string;
		latitude?: number;
		longitude?: number;
	};
	responses?: {
		acceptedIds?: string[];
		declinedIds?: string[];
		waitinglistIds?: string[];
		unansweredIds?: string[];
	};
	recipients?: {
		group?: {
			id: string;
			name: string;
		};
		groupMembers?: Array<{ id: string }>;
	};
	owners?: Array<{ id: string; firstName?: string; lastName?: string }>;
}

export interface SpondGroup {
	id: string;
	name: string;
	members: Array<{
		id: string;
		firstName: string;
		lastName: string;
		email?: string;
		profile?: { id: string };
		roles?: string[];
		guardians?: Array<{ id: string; firstName: string; lastName: string; email?: string }>;
	}>;
	subGroups?: Array<{ id: string; name: string }>;
}

/**
 * Login to Spond and return a bearer token.
 * Spond uses username/password auth (no OAuth).
 */
export async function spondLogin(email: string, password: string): Promise<string> {
	const res = await fetch(`${SPOND_API_BASE}login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Spond login failed (${res.status}): ${body}`);
	}

	const data = await res.json();
	const token = data?.loginToken;
	if (!token) {
		throw new Error('Spond login response missing loginToken');
	}
	return token as string;
}

function authHeaders(token: string) {
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`
	};
}

/**
 * Fetch all groups the authenticated user is a member of.
 */
export async function spondGetGroups(token: string): Promise<SpondGroup[]> {
	const res = await fetch(`${SPOND_API_BASE}groups/`, {
		headers: authHeaders(token)
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Spond getGroups failed (${res.status}): ${body}`);
	}

	return res.json();
}

/**
 * Fetch the authenticated user's profile.
 * Returns an object with at least { id, firstName, lastName, email }.
 */
export async function spondGetProfile(token: string): Promise<{ id: string; firstName?: string; lastName?: string; email?: string; [key: string]: any }> {
	const res = await fetch(`${SPOND_API_BASE}profile`, {
		headers: authHeaders(token)
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Spond getProfile failed (${res.status}): ${body}`);
	}

	return res.json();
}

/**
 * Fetch events from Spond.
 */
export async function spondGetEvents(
	token: string,
	options: {
		groupId?: string;
		minStart?: Date;
		maxStart?: Date;
		maxEvents?: number;
		includeScheduled?: boolean;
	} = {}
): Promise<SpondEvent[]> {
	const params = new URLSearchParams({
		max: String(options.maxEvents ?? 200),
		scheduled: String(options.includeScheduled ?? false)
	});
	if (options.minStart) params.set('minStartTimestamp', DT_FORMAT(options.minStart));
	if (options.maxStart) params.set('maxStartTimestamp', DT_FORMAT(options.maxStart));
	if (options.groupId) params.set('groupId', options.groupId);

	const res = await fetch(`${SPOND_API_BASE}sponds/?${params}`, {
		headers: authHeaders(token)
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Spond getEvents failed (${res.status}): ${body}`);
	}

	return res.json();
}
