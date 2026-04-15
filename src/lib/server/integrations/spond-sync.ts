import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { spondLogin, spondGetGroups, spondGetEvents, spondGetProfile, type SpondEvent, type SpondGroup } from './spond';

/**
 * Retrieve the active Spond sensor row for a user.
 */
export async function getSpondSensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'spond'),
			eq(sensors.isActive, true)
		)
	});
}

/**
 * Decode credentials stored in the sensor row and return email + password.
 * Credentials are stored as base64-encoded JSON: { email, password }.
 */
function decodeSpondCredentials(encoded: string): { email: string; password: string } {
	return JSON.parse(atob(encoded));
}

/**
 * Login to Spond using stored credentials and return a fresh bearer token.
 */
async function getFreshToken(sensor: { credentials: string | null }): Promise<string> {
	if (!sensor.credentials) throw new Error('Spond sensor has no stored credentials');
	const { email, password } = decodeSpondCredentials(sensor.credentials);
	return spondLogin(email, password);
}

/**
 * Convert a Spond event into a sensor_event row.
 */
function parseSpondEvent(
	event: SpondEvent,
	userId: string,
	sensorId: string,
	groupName?: string
) {
	return {
		userId,
		sensorId,
		eventType: 'activity' as const,
		dataType: 'spond_event' as const,
		timestamp: new Date(event.startTimestamp),
		data: {
			name: event.heading,
			description: event.description || null,
			startTimestamp: event.startTimestamp,
			endTimestamp: event.endTimestamp,
			cancelled: event.cancelled ?? false,
			location: event.location
				? {
						name: event.location.feature || null,
						address: event.location.address || null,
						lat: event.location.latitude || null,
						lng: event.location.longitude || null
					}
				: null,
			groupName: groupName ?? event.recipients?.group?.name ?? null,
			groupId: event.recipients?.group?.id ?? null,
			responses: {
				acceptedIds: event.responses?.acceptedIds ?? [],
				declinedIds: event.responses?.declinedIds ?? [],
				waitinglistIds: event.responses?.waitinglistIds ?? [],
				unansweredIds: event.responses?.unansweredIds ?? []
			}
		},
		metadata: {
			spondEventId: event.id,
			endTimestamp: event.endTimestamp,
			type: event.type ?? null
		}
	};
}

/**
 * Sync Spond events for a user.
 *
 * Fetches events from 1 year ago up to 1 year ahead.
 * Uses ON CONFLICT DO NOTHING to avoid duplicates (unique on sensorId + dataType + timestamp,
 * but Spond events can share a timestamp, so we rely on the spondEventId in metadata
 * and handle uniqueness via the DB unique index on (sensorId, dataType, timestamp).
 *
 * For conflicts at the same timestamp, later imports will be silently skipped.
 * A future improvement could use ON CONFLICT DO UPDATE to refresh event data.
 */
export async function syncSpondData(userId: string): Promise<{ events: number; groups: number }> {
	const sensor = await getSpondSensor(userId);
	if (!sensor) {
		throw new Error('No active Spond sensor found for this user');
	}

	const token = await getFreshToken(sensor);

	// Fetch profile + groups in parallel
	const [profile, groups] = await Promise.all([
		spondGetProfile(token).catch(() => null),
		spondGetGroups(token)
	]);

	// Collect all member IDs associated with this Spond account.
	// We look for the user's own profile ID and any members who share
	// the same guardian email (i.e. children registered under the same parent).
	const myMemberIds = new Set<string>();
	if (profile?.id) myMemberIds.add(profile.id);

	const { email: accountEmail } = decodeSpondCredentials(sensor.credentials!);
	for (const group of groups) {
		for (const member of group.members ?? []) {
			// Direct member match by email or profile id
			if (member.email === accountEmail || (profile?.id && member.profile?.id === profile.id)) {
				myMemberIds.add(member.id);
			}
			// Children whose guardian is us
			for (const guardian of member.guardians ?? []) {
				if (guardian.email === accountEmail) {
					myMemberIds.add(member.id);
				}
			}
		}
	}

	// Sync window: 1 year back → 1 year ahead
	const minStart = new Date();
	minStart.setFullYear(minStart.getFullYear() - 1);
	const maxStart = new Date();
	maxStart.setFullYear(maxStart.getFullYear() + 1);

	let totalEvents = 0;

	// Fetch events per group for accurate group name tagging
	for (const group of groups) {
		const events = await spondGetEvents(token, {
			groupId: group.id,
			minStart,
			maxStart,
			maxEvents: 500
		});

		if (events.length === 0) continue;

		const rows = events.map((e) => parseSpondEvent(e, userId, sensor.id, group.name));

		await db
			.insert(sensorEvents)
			.values(rows)
			.onConflictDoNothing();

		totalEvents += events.length;
	}

	// Persist member IDs in sensor config so the UI can highlight pending RSVPs
	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date(),
			config: {
				...((sensor.config as any) ?? {}),
				myMemberIds: [...myMemberIds],
				profileId: profile?.id ?? null
			}
		})
		.where(eq(sensors.id, sensor.id));

	return { events: totalEvents, groups: groups.length };
}
