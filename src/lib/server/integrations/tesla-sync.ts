import { db } from '$lib/db';
import { sensors, liveSessions, sensorEvents } from '$lib/db/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { encryptSecret, decryptSecret } from '$lib/server/crypto';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { aggregateCurrentPeriods } from '$lib/server/integrations/aggregation';
import {
	refreshAccessToken,
	getVehicleData,
	getRegion,
	type VehicleDataResult
} from './tesla';
import { parseVehicleData, buildSnapshot, type TeslaSnapshot } from './tesla-parser';

interface TeslaCredentials {
	access_token: string;
	refresh_token: string;
	expires_at: number; // epoch-sekunder
}

interface TeslaConfig {
	vin?: string;
	vehicleId?: string | number;
	fleetApiBaseUrl?: string;
	scope?: string;
	[key: string]: unknown;
}

const TOKEN_REFRESH_BUFFER_S = 300; // 5 min

export async function getTeslaSensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'tesla'),
			eq(sensors.isActive, true)
		)
	});
}

function readCredentials(sensor: { credentials: string | null }): TeslaCredentials {
	if (!sensor.credentials) throw new Error('Tesla-sensor mangler credentials');
	return JSON.parse(decryptSecret(sensor.credentials)) as TeslaCredentials;
}

/**
 * Returner en gyldig access token, refresh om nødvendig (5 min buffer).
 * Persisterer nye tokens kryptert.
 */
export async function getValidAccessToken(sensor: {
	id: string;
	credentials: string | null;
	config: TeslaConfig | null;
}): Promise<string> {
	const creds = readCredentials(sensor);
	const now = Math.floor(Date.now() / 1000);

	if (creds.expires_at && now < creds.expires_at - TOKEN_REFRESH_BUFFER_S) {
		return creds.access_token;
	}

	const refreshed = await refreshAccessToken(creds.refresh_token);
	const newCreds: TeslaCredentials = {
		access_token: refreshed.access_token,
		refresh_token: refreshed.refresh_token,
		expires_at: now + refreshed.expires_in
	};

	await db
		.update(sensors)
		.set({
			credentials: encryptSecret(JSON.stringify(newCreds)),
			config: { ...(sensor.config ?? {}), expiresAt: newCreds.expires_at },
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	return newCreds.access_token;
}

export interface TeslaSyncResult {
	asleep: boolean;
	eventsWritten: number;
	snapshot: TeslaSnapshot | null;
}

/**
 * Hent fersk vehicle_data, skriv sensor-events og oppdater eventuell aktiv
 * kjøre-økt. Vekker ikke bilen — sover den, logges en vellykket tom kjøring.
 */
export async function syncTeslaForUser(userId: string): Promise<TeslaSyncResult> {
	const sensor = await getTeslaSensor(userId);
	if (!sensor) throw new Error('Ingen aktiv Tesla-sensor for bruker');

	const config = (sensor.config ?? {}) as TeslaConfig;
	const baseUrl = config.fleetApiBaseUrl;
	const vehicleTag = config.vehicleId ?? config.vin;
	if (!baseUrl || !vehicleTag) {
		throw new Error('Tesla-sensor mangler fleetApiBaseUrl eller vehicleId i config');
	}

	const accessToken = await getValidAccessToken(sensor);

	let result: VehicleDataResult;
	try {
		result = await getVehicleData(accessToken, baseUrl, vehicleTag);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(sensors)
			.set({ lastError: message, updatedAt: new Date() })
			.where(eq(sensors.id, sensor.id));
		throw err;
	}

	const now = new Date();

	if (!result.ok) {
		// Bilen sover — registrer vellykket (men tom) kjøring.
		await db
			.update(sensors)
			.set({ lastSync: now, lastError: null, updatedAt: now })
			.where(eq(sensors.id, sensor.id));
		return { asleep: true, eventsWritten: 0, snapshot: buildSnapshot(null, now) };
	}

	const snapshot = buildSnapshot(result.data, now);
	const parsed = parseVehicleData(result.data, now);

	if (parsed.length > 0) {
		await SensorEventService.writeMany(
			parsed.map((e) => ({
				userId,
				sensorId: sensor.id,
				eventType: e.eventType,
				dataType: e.dataType,
				timestamp: e.timestamp,
				data: e.data,
				source: 'tesla_sync'
			})),
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
		);
		await aggregateCurrentPeriods(userId);
	}

	await db
		.update(sensors)
		.set({ lastSync: now, lastError: null, updatedAt: now })
		.where(eq(sensors.id, sensor.id));

	// Mat en eventuell aktiv kjøre-økt (live tracking, modell A).
	await updateDrivingLiveSession(userId, snapshot);

	return { asleep: false, eventsWritten: parsed.length, snapshot };
}

/**
 * Bygg et forenklet øyeblikksbilde fra ferskeste lagrede sensor-events (uten å
 * kontakte Tesla). Brukes av Ekko-state-endepunktet i ikke-live-modus.
 */
export async function getStoredTeslaState(userId: string): Promise<{
	connected: boolean;
	state: Partial<TeslaSnapshot> & { asOf?: string } | null;
}> {
	const sensor = await getTeslaSensor(userId);
	if (!sensor) return { connected: false, state: null };

	const latest: Record<string, { timestamp: Date; data: Record<string, any> }> = {};
	for (const dataType of ['charge_state', 'vehicle_state', 'drive_state'] as const) {
		const rows = await db.query.sensorEvents.findMany({
			where: and(eq(sensorEvents.sensorId, sensor.id), eq(sensorEvents.dataType, dataType)),
			orderBy: [desc(sensorEvents.timestamp)],
			limit: 1
		});
		if (rows[0]) latest[dataType] = { timestamp: rows[0].timestamp, data: (rows[0].data ?? {}) as Record<string, any> };
	}

	const charge = latest.charge_state?.data ?? {};
	const vehicle = latest.vehicle_state?.data ?? {};
	const drive = latest.drive_state?.data ?? {};
	const asOf = [latest.charge_state, latest.vehicle_state, latest.drive_state]
		.map((e) => e?.timestamp?.getTime() ?? 0)
		.reduce((a, b) => Math.max(a, b), 0);

	return {
		connected: true,
		state: {
			batteryPercent: charge.batteryPercent,
			rangeKm: charge.rangeKm,
			charging: charge.charging,
			chargingState: charge.chargingState,
			chargeRateKw: charge.chargeRateKw,
			odometerKm: vehicle.odometerKm,
			locked: vehicle.locked,
			insideTempC: vehicle.insideTempC,
			outsideTempC: vehicle.outsideTempC,
			location: drive.lat !== undefined && drive.lon !== undefined ? { lat: drive.lat, lon: drive.lon } : undefined,
			speedKmh: drive.speedKmh,
			asOf: asOf ? new Date(asOf).toISOString() : undefined
		}
	};
}

/**
 * Oppdater en aktiv kjøre-økt (sportType='driving') med bilens posisjon og
 * batteritilstand. No-op hvis ingen aktiv kjøre-økt finnes.
 */
export async function updateDrivingLiveSession(
	userId: string,
	snapshot: TeslaSnapshot
): Promise<void> {
	if (!snapshot.location) return;

	const active = await db.query.liveSessions.findFirst({
		where: and(
			eq(liveSessions.userId, userId),
			eq(liveSessions.sportType, 'driving'),
			isNull(liveSessions.endedAt)
		)
	});
	if (!active) return;

	await db
		.update(liveSessions)
		.set({
			lastLat: snapshot.location.lat,
			lastLon: snapshot.location.lon,
			lastSpeedMps:
				snapshot.speedKmh !== undefined
					? Math.round((snapshot.speedKmh / 3.6) * 100) / 100
					: null,
			batteryPercent: snapshot.batteryPercent ?? null,
			rangeKm: snapshot.rangeKm ?? null,
			charging: snapshot.charging ?? null,
			lastPingAt: new Date()
		})
		.where(eq(liveSessions.id, active.id));
}
