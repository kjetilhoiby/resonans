import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import {
	continueDropboxFolder,
	downloadDropboxFile,
	listDropboxFolder,
	refreshDropboxAccessToken,
	type DropboxListFolderEntry
} from '$lib/server/integrations/dropbox';
import { getWorkoutContextForUser, type WorkoutContextSummary } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';

interface DropboxCredentials {
	access_token: string;
	refresh_token?: string;
	expires_at?: number;
	scope?: string;
	token_type?: string;
	account_id?: string;
}

interface DropboxSensorConfig {
	expiresAt?: number;
	dropboxFolderPath?: string;
	dropboxCursor?: string;
	lastImportedAt?: string;
	[ key: string ]: unknown;
}

interface TrackPoint {
	lat: number;
	lon: number;
	ele?: number;
	hr?: number;
	time?: string;
}

export interface ParsedWorkout {
	sportType: string;
	startTime: Date;
	duration: number;
	distance: number;
	elevation: number;
	avgHeartRate?: number;
	maxHeartRate?: number;
	minHeartRate?: number;
	trackPoints: TrackPoint[];
	sourceFormat: 'gpx' | 'tcx';
}

function decodeCredentials(encoded: string): DropboxCredentials {
	const parseCandidate = (value: string): DropboxCredentials | null => {
		try {
			const parsed = JSON.parse(value) as DropboxCredentials;
			if (parsed && typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
				return parsed;
			}
			return null;
		} catch {
			return null;
		}
	};

	const decoded = parseCandidate(atob(encoded));
	if (decoded) return decoded;

	// Fallback: support legacy/plain JSON storage if present.
	const raw = parseCandidate(encoded);
	if (raw) return raw;

	throw new Error('Ugyldige Dropbox-credentials lagret. Koble fra og koble til Dropbox på nytt.');
}

function encodeCredentials(credentials: DropboxCredentials): string {
	return btoa(JSON.stringify(credentials));
}

function toNumber(value?: string): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function haversineMeters(a: TrackPoint, b: TrackPoint): number {
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function computeDistance(points: TrackPoint[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i += 1) {
		total += haversineMeters(points[i - 1], points[i]);
	}
	return total;
}

function computeElevationGain(points: TrackPoint[]): number {
	let gain = 0;
	for (let i = 1; i < points.length; i += 1) {
		const prev = points[i - 1].ele;
		const curr = points[i].ele;
		if (typeof prev === 'number' && typeof curr === 'number' && curr > prev) {
			gain += curr - prev;
		}
	}
	return gain;
}

function parseGpx(content: string): ParsedWorkout | null {
	const points: TrackPoint[] = [];
	const trkptRe = /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
	let match: RegExpExecArray | null;

	while ((match = trkptRe.exec(content)) !== null) {
		const lat = Number(match[1]);
		const lon = Number(match[2]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

		const block = match[3] || '';
		const ele = toNumber(block.match(/<ele>([^<]+)<\/ele>/)?.[1]);
		const time = block.match(/<time>([^<]+)<\/time>/)?.[1];
		const hr = toNumber(
			block.match(/<(?:gpxtpx:)?hr>([^<]+)<\/(?:gpxtpx:)?hr>/i)?.[1] ??
			block.match(/<ns3:hr>([^<]+)<\/ns3:hr>/i)?.[1]
		);

		points.push({ lat, lon, ele, hr, time });
	}

	if (points.length < 2) return null;

	const firstTs = points.find((p) => p.time)?.time;
	const lastTs = [...points].reverse().find((p) => p.time)?.time;
	const startTime = firstTs ? new Date(firstTs) : new Date();
	const endTime = lastTs ? new Date(lastTs) : startTime;
	const duration = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000));

	const hrValues = points.map((p) => p.hr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	const distance = computeDistance(points);

	return {
		sportType: 'running',
		startTime,
		duration,
		distance,
		elevation: computeElevationGain(points),
		avgHeartRate: hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : undefined,
		maxHeartRate: hrValues.length ? Math.max(...hrValues) : undefined,
		minHeartRate: hrValues.length ? Math.min(...hrValues) : undefined,
		trackPoints: points,
		sourceFormat: 'gpx'
	};
}

function parseTcx(content: string): ParsedWorkout | null {
	const sportType = content.match(/<Activity\s+Sport="([^"]+)"/i)?.[1]?.toLowerCase() || 'running';
	const points: TrackPoint[] = [];
	const tpRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
	let match: RegExpExecArray | null;
	let lastDistance: number | undefined;

	while ((match = tpRe.exec(content)) !== null) {
		const block = match[1] || '';
		const lat = toNumber(block.match(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/)?.[1]);
		const lon = toNumber(block.match(/<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/)?.[1]);
		const ele = toNumber(block.match(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/)?.[1]);
		const time = block.match(/<Time>([^<]+)<\/Time>/)?.[1];
		const hr = toNumber(block.match(/<HeartRateBpm>[\s\S]*?<Value>([^<]+)<\/Value>[\s\S]*?<\/HeartRateBpm>/)?.[1]);
		const distanceMeters = toNumber(block.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/)?.[1]);

		if (typeof distanceMeters === 'number') {
			lastDistance = distanceMeters;
		}

		if (typeof lat === 'number' && typeof lon === 'number') {
			points.push({ lat, lon, ele, hr, time });
		}
	}

	if (points.length < 2 && typeof lastDistance !== 'number') return null;

	const startTimeRaw =
		content.match(/<Id>([^<]+)<\/Id>/)?.[1] ??
		points.find((p) => p.time)?.time;
	const startTime = startTimeRaw ? new Date(startTimeRaw) : new Date();
	const endTimeRaw = [...points].reverse().find((p) => p.time)?.time;
	const endTime = endTimeRaw ? new Date(endTimeRaw) : startTime;
	const duration = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
	const distance = typeof lastDistance === 'number' ? lastDistance : computeDistance(points);
	const hrValues = points.map((p) => p.hr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

	return {
		sportType,
		startTime,
		duration,
		distance,
		elevation: computeElevationGain(points),
		avgHeartRate: hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : undefined,
		maxHeartRate: hrValues.length ? Math.max(...hrValues) : undefined,
		minHeartRate: hrValues.length ? Math.min(...hrValues) : undefined,
		trackPoints: points,
		sourceFormat: 'tcx'
	};
}

export function parseWorkoutFile(path: string, content: string): ParsedWorkout | null {
	if (path.toLowerCase().endsWith('.gpx')) return parseGpx(content);
	if (path.toLowerCase().endsWith('.tcx')) return parseTcx(content);
	return null;
}

function shouldImport(entry: DropboxListFolderEntry): boolean {
	if (entry['.tag'] !== 'file') return false;
	const path = (entry.path_lower || '').toLowerCase();
	return path.endsWith('.gpx') || path.endsWith('.tcx');
}

export async function getDropboxSensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'dropbox'),
			eq(sensors.type, 'workout_files'),
			eq(sensors.isActive, true)
		)
	});
}

export async function getValidDropboxAccessToken(sensor: typeof sensors.$inferSelect): Promise<string> {
	if (!sensor.credentials) {
		throw new Error('Dropbox credentials mangler');
	}
	let credentials: DropboxCredentials;
	try {
		credentials = decodeCredentials(sensor.credentials);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Klarte ikke lese Dropbox-credentials';
		await db.update(sensors)
			.set({
				lastError: message,
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));
		throw new Error(message);
	}
	const now = Math.floor(Date.now() / 1000);

	if (!credentials.expires_at || now < credentials.expires_at - 60) {
		return credentials.access_token;
	}

	if (!credentials.refresh_token) {
		throw new Error('Dropbox token utløpt og mangler refresh token. Koble til på nytt.');
	}

	const refreshed = await refreshDropboxAccessToken(credentials.refresh_token);
	const expiresAt = now + (refreshed.expires_in ?? 14400);
	const updatedCredentials: DropboxCredentials = {
		...credentials,
		access_token: refreshed.access_token,
		expires_at: expiresAt,
		token_type: refreshed.token_type,
		scope: refreshed.scope
	};

	const currentConfig = (sensor.config ?? {}) as DropboxSensorConfig;
	await db.update(sensors)
		.set({
			credentials: encodeCredentials(updatedCredentials),
			config: {
				...currentConfig,
				expiresAt
			},
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	return updatedCredentials.access_token;
}

async function sourcePathExists(sensorId: string, sourcePath: string) {
	const existing = await db.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(and(
			eq(sensorEvents.sensorId, sensorId),
			sql`${sensorEvents.metadata}->>'sourcePath' = ${sourcePath}`
		))
		.limit(1);

	return existing.length > 0;
}

export async function syncDropboxWorkoutsForUser(
	userId: string,
	options?: { fullRescan?: boolean; appUrl?: string }
) {
	const sensor = await getDropboxSensor(userId);
	if (!sensor) {
		throw new Error('Dropbox er ikke koblet til');
	}

	const config = (sensor.config ?? {}) as DropboxSensorConfig;
	const watchedPath = typeof config.dropboxFolderPath === 'string' ? config.dropboxFolderPath : '';
	if (!watchedPath) {
		throw new Error('Ingen mappe valgt for overvåking');
	}

	const accessToken = await getValidDropboxAccessToken(sensor);
	const resetCursor = options?.fullRescan === true;
	const currentCursor = !resetCursor && typeof config.dropboxCursor === 'string' ? config.dropboxCursor : '';

	let entries: DropboxListFolderEntry[] = [];
	let cursor = currentCursor;

	if (!cursor) {
		let page = await listDropboxFolder(accessToken, watchedPath);
		entries.push(...page.entries);
		cursor = page.cursor;
		while (page.has_more) {
			page = await continueDropboxFolder(accessToken, cursor);
			entries.push(...page.entries);
			cursor = page.cursor;
		}
	} else {
		let page = await continueDropboxFolder(accessToken, cursor);
		entries.push(...page.entries);
		cursor = page.cursor;
		while (page.has_more) {
			page = await continueDropboxFolder(accessToken, cursor);
			entries.push(...page.entries);
			cursor = page.cursor;
		}
	}

	const workoutFiles = entries.filter(shouldImport);
	let imported = 0;
	let skipped = 0;
	let failed = 0;
	const importedWorkoutIds: string[] = [];

	for (const file of workoutFiles) {
		const sourcePath = file.path_lower || file.path_display || file.name;
		if (!sourcePath) {
			skipped += 1;
			continue;
		}

		if (await sourcePathExists(sensor.id, sourcePath)) {
			skipped += 1;
			continue;
		}

		try {
			const raw = await downloadDropboxFile(accessToken, sourcePath);
			const parsed = parseWorkoutFile(sourcePath, raw);
			if (!parsed) {
				skipped += 1;
				continue;
			}

			const paceSecondsPerKm = parsed.distance > 0 ? (parsed.duration / (parsed.distance / 1000)) : undefined;
			const sampledTrack = parsed.trackPoints.slice(0, 500).map((p) => ({
				lat: p.lat,
				lon: p.lon,
				ele: p.ele,
				hr: p.hr,
				time: p.time
			}));

			const [insertedWorkout] = await db.insert(sensorEvents).values({
				userId,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: parsed.startTime,
				data: {
					sportType: parsed.sportType,
					duration: parsed.duration,
					distance: parsed.distance,
					elevation: parsed.elevation,
					avgHeartRate: parsed.avgHeartRate,
					maxHeartRate: parsed.maxHeartRate,
					minHeartRate: parsed.minHeartRate,
					paceSecondsPerKm,
					trackPoints: sampledTrack
				},
				metadata: {
					source: 'dropbox',
					sourcePath,
					sourceName: file.name,
					sourceRev: file.rev,
					sourceFormat: parsed.sourceFormat,
					totalTrackPoints: parsed.trackPoints.length,
					serverModified: file.server_modified,
					clientModified: file.client_modified
				}
			}).returning({ id: sensorEvents.id });

			imported += 1;
			if (insertedWorkout?.id) importedWorkoutIds.push(insertedWorkout.id);
		} catch (error) {
			failed += 1;
			console.error('[dropbox-sync] import failed for file:', sourcePath, error);
		}
	}

	const updatedConfig: DropboxSensorConfig = {
		...config,
		dropboxFolderPath: watchedPath,
		dropboxCursor: cursor,
		lastImportedAt: new Date().toISOString(),
		expiresAt: typeof config.expiresAt === 'number' ? config.expiresAt : undefined
	};

	await db.update(sensors)
		.set({
			config: updatedConfig,
			lastSync: new Date(),
			lastError: failed > 0 ? `${failed} filer feilet under import` : null,
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	let notified = 0;
	if (options?.fullRescan !== true && options?.appUrl && importedWorkoutIds.length > 0) {
		const importedWorkouts = (
			await Promise.all(importedWorkoutIds.map((workoutId) => getWorkoutContextForUser(userId, workoutId)))
		).filter((workout): workout is WorkoutContextSummary => workout !== null);

		const notificationResult = await notifyUserAboutImportedWorkouts({
			userId,
			appUrl: options.appUrl,
			workouts: importedWorkouts
		});
		notified = notificationResult.sent;
	}

	return {
		imported,
		skipped,
		failed,
		notified,
		cursor,
		watchedPath,
		totalCandidates: workoutFiles.length
	};
}

export async function syncDropboxWorkoutsForAllUsers(options?: { appUrl?: string }) {
	const activeSensors = await db.query.sensors.findMany({
		where: and(
			eq(sensors.provider, 'dropbox'),
			eq(sensors.type, 'workout_files'),
			eq(sensors.isActive, true)
		)
	});

	const userIds = [...new Set(activeSensors.map((sensor) => sensor.userId))];
	const results: Array<Record<string, unknown>> = [];

	for (const userId of userIds) {
		try {
			const result = await syncDropboxWorkoutsForUser(userId, { appUrl: options?.appUrl });
			results.push({ userId, success: true, ...result });
		} catch (error) {
			results.push({
				userId,
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return {
		users: userIds.length,
		results
	};
}
