import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { parseWorkoutFile, type ParsedWorkout } from '$lib/server/integrations/dropbox-sync';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import type { EmailEnvelope, EmailHandler, EmailHandlerResult } from '../types';

async function findOrCreateWorkoutSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'email'),
			eq(sensors.type, 'workout_files')
		)
	});
	if (existing) return existing;

	const [created] = await db.insert(sensors).values({
		userId,
		provider: 'email',
		type: 'workout_files',
		name: 'E-post import',
		isActive: true
	}).returning();

	return created;
}

type RawPoint = { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null };

export function decimateTrack(pts: RawPoint[], maxPoints: number): RawPoint[] {
	if (pts.length <= maxPoints) return pts;

	function dist(a: RawPoint, b: RawPoint): number {
		const R = 6371000;
		const dLat = ((b.lat - a.lat) * Math.PI) / 180;
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
	}

	function bearing(a: RawPoint, b: RawPoint): number {
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const lat1 = (a.lat * Math.PI) / 180;
		const lat2 = (b.lat * Math.PI) / 180;
		return Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
	}

	const scores = new Float64Array(pts.length);
	scores[0] = Infinity;
	scores[pts.length - 1] = Infinity;

	const speeds: number[] = [];
	for (let i = 1; i < pts.length; i++) {
		const d = dist(pts[i - 1], pts[i]);
		const tA = pts[i - 1].time ? new Date(pts[i - 1].time!).getTime() : 0;
		const tB = pts[i].time ? new Date(pts[i].time!).getTime() : 0;
		const dt = tA && tB ? (tB - tA) / 1000 : 0;
		speeds.push(dt > 0 ? d / dt : 0);
	}
	const maxSpeed = Math.max(...speeds, 1);
	const hrValues = pts.map((p) => p.hr ?? null).filter((v): v is number => v !== null);
	const hrRange = hrValues.length ? Math.max(...hrValues) - Math.min(...hrValues) : 1;

	for (let i = 1; i < pts.length - 1; i++) {
		const b1 = bearing(pts[i - 1], pts[i]);
		const b2 = bearing(pts[i], pts[i + 1]);
		let dirDelta = Math.abs(b2 - b1);
		if (dirDelta > Math.PI) dirDelta = 2 * Math.PI - dirDelta;
		const dirScore = dirDelta / Math.PI;

		const speedDelta = Math.abs(speeds[i] - speeds[i - 1]) / maxSpeed;

		const hrA = pts[i - 1].hr;
		const hrB = pts[i].hr;
		const hrScore = hrA != null && hrB != null ? Math.abs(hrB - hrA) / (hrRange || 1) : 0;

		scores[i] = dirScore * 0.5 + speedDelta * 0.3 + hrScore * 0.2;
	}

	const indices = Array.from({ length: pts.length }, (_, i) => i);
	indices.sort((a, b) => scores[b] - scores[a]);
	const kept = new Set(indices.slice(0, maxPoints));

	return pts.filter((_, i) => kept.has(i));
}

export function buildWorkoutData(parsed: ParsedWorkout) {
	const paceSecondsPerKm = parsed.distance > 0
		? parsed.duration / (parsed.distance / 1000)
		: undefined;

	const MAX_POINTS = 1800;
	const raw = parsed.trackPoints;
	const sampledTrack = decimateTrack(raw, MAX_POINTS).map((p) => ({
		lat: p.lat,
		lon: p.lon,
		ele: p.ele,
		hr: p.hr,
		time: p.time
	}));

	return {
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
			source: 'email',
			sourceFormat: parsed.sourceFormat,
			totalTrackPoints: parsed.trackPoints.length
		}
	};
}

export const workoutHandler: EmailHandler = {
	label: 'Resonans/Workout',

	async handle(envelope: EmailEnvelope): Promise<EmailHandlerResult> {
		const attachments = envelope.attachments.filter(
			(a) => a.name?.toLowerCase().endsWith('.gpx') || a.name?.toLowerCase().endsWith('.tcx')
		);

		if (attachments.length === 0) {
			return { imported: 0, failed: 0, notes: ['no_workout_attachments'] };
		}

		const sensor = await findOrCreateWorkoutSensor(envelope.userId);

		let imported = 0;
		let failed = 0;
		const importedWorkoutIds: string[] = [];

		for (const attachment of attachments) {
			try {
				const content = atob(attachment.base64);
				const parsed = parseWorkoutFile(attachment.name, content);
				if (!parsed) {
					failed += 1;
					continue;
				}

				const { data, metadata } = buildWorkoutData(parsed);

				const { event: inserted } = await SensorEventService.write({
					userId: envelope.userId,
					sensorId: sensor.id,
					eventType: 'activity',
					dataType: 'workout',
					timestamp: parsed.startTime,
					data,
					metadata: {
						...metadata,
						sourceName: attachment.name,
						gmailMessageId: envelope.gmailMessageId,
						gmailThreadId: envelope.gmailThreadId
					},
					source: 'email_inbound'
				}, {
					conflictMode: 'upsert_sensor_datatype_timestamp'
				});

				if (inserted?.id) importedWorkoutIds.push(inserted.id);
				imported += 1;
			} catch (error) {
				failed += 1;
				console.error('[email/workout] import failed for attachment:', attachment.name, error);
			}
		}

		await db.update(sensors)
			.set({ lastSync: new Date(), updatedAt: new Date() })
			.where(eq(sensors.id, sensor.id));

		if (importedWorkoutIds.length > 0) {
			const appUrl = env.ORIGIN ?? '';
			const importedWorkouts = (
				await Promise.all(importedWorkoutIds.map((id) => getWorkoutContextForUser(envelope.userId, id)))
			).filter((w): w is NonNullable<typeof w> => w !== null);

			if (appUrl) {
				await notifyUserAboutImportedWorkouts({
					userId: envelope.userId,
					appUrl,
					workouts: importedWorkouts
				}).catch((err) => console.error('[email/workout] notification failed:', err));
			}
		}

		return { imported, failed };
	}
};
