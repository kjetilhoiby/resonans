import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors, sensorEvents, users } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { parseWorkoutFile, type ParsedWorkout } from '$lib/server/integrations/dropbox-sync';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';

// Postmark inbound webhook payload (simplified)
interface PostmarkAttachment {
	Name: string;
	Content: string; // base64
	ContentType: string;
	ContentLength: number;
}

interface PostmarkInboundPayload {
	From: string;
	FromFull?: { Email: string; Name?: string };
	Subject?: string;
	Attachments?: PostmarkAttachment[];
}

export const config = { maxDuration: 30 };

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

async function findOrCreateEmailSensor(userId: string) {
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

function decimateTrack(pts: RawPoint[], maxPoints: number): RawPoint[] {
	if (pts.length <= maxPoints) return pts;

	// Haversine distance in metres between two lat/lon points
	function dist(a: RawPoint, b: RawPoint): number {
		const R = 6371000;
		const dLat = ((b.lat - a.lat) * Math.PI) / 180;
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
	}

	// Heading in radians
	function bearing(a: RawPoint, b: RawPoint): number {
		const dLon = ((b.lon - a.lon) * Math.PI) / 180;
		const lat1 = (a.lat * Math.PI) / 180;
		const lat2 = (b.lat * Math.PI) / 180;
		return Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
	}

	// Score each interior point by how much it differs from its neighbours
	// in direction, HR and derived speed. Start/end always kept.
	const scores = new Float64Array(pts.length); // 0 = always keep, higher = more important
	scores[0] = Infinity;
	scores[pts.length - 1] = Infinity;

	// Pre-compute per-segment speeds (m/s) for normalisation
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
		// Direction change (rad, 0–π)
		const b1 = bearing(pts[i - 1], pts[i]);
		const b2 = bearing(pts[i], pts[i + 1]);
		let dirDelta = Math.abs(b2 - b1);
		if (dirDelta > Math.PI) dirDelta = 2 * Math.PI - dirDelta;
		const dirScore = dirDelta / Math.PI; // 0–1

		// Speed change (normalised)
		const speedDelta = Math.abs(speeds[i] - speeds[i - 1]) / maxSpeed;

		// HR change (normalised, 0 if no HR data)
		const hrA = pts[i - 1].hr;
		const hrB = pts[i].hr;
		const hrScore = hrA != null && hrB != null ? Math.abs(hrB - hrA) / (hrRange || 1) : 0;

		scores[i] = dirScore * 0.5 + speedDelta * 0.3 + hrScore * 0.2;
	}

	// Select top maxPoints indices by score, always including 0 and last
	const indices = Array.from({ length: pts.length }, (_, i) => i);
	indices.sort((a, b) => scores[b] - scores[a]);
	const kept = new Set(indices.slice(0, maxPoints));

	// Return in original chronological order
	return pts.filter((_, i) => kept.has(i));
}

function buildWorkoutData(parsed: ParsedWorkout) {
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

export const POST: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	const secret = env.EMAIL_WEBHOOK_SECRET;

	console.log('[email-inbound] auth check — secret set:', !!secret, '| token set:', !!token, '| secret len:', secret?.length ?? 0, '| token len:', token?.length ?? 0, '| match:', secret && token ? timingSafeEqual(token, secret) : false);

	if (!secret || !token || !timingSafeEqual(token, secret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let payload: PostmarkInboundPayload;
	try {
		payload = await request.json() as PostmarkInboundPayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const senderEmail = (payload.FromFull?.Email ?? payload.From ?? '').toLowerCase().trim();
	if (!senderEmail) {
		return json({ error: 'Missing sender email' }, { status: 400 });
	}

	// Extract address from "Name <email>" format
	const emailMatch = senderEmail.match(/<([^>]+)>/) ?? senderEmail.match(/^([^\s]+)$/);
	const cleanEmail = emailMatch ? emailMatch[1] : senderEmail;

	const user = await db.query.users.findFirst({
		where: eq(users.email, cleanEmail)
	});

	if (!user) {
		// Return 200 to prevent Postmark from retrying — sender is not a known user
		return json({ skipped: true, reason: 'unknown_sender' });
	}

	const attachments = (payload.Attachments ?? []).filter(
		(a) => a.Name?.toLowerCase().endsWith('.gpx') || a.Name?.toLowerCase().endsWith('.tcx')
	);

	if (attachments.length === 0) {
		return json({ skipped: true, reason: 'no_workout_attachments' });
	}

	const sensor = await findOrCreateEmailSensor(user.id);

	let imported = 0;
	let failed = 0;
	const importedWorkoutIds: string[] = [];

	for (const attachment of attachments) {
		try {
			const content = atob(attachment.Content);
			const parsed = parseWorkoutFile(attachment.Name, content);
			if (!parsed) {
				failed += 1;
				continue;
			}

			const { data, metadata } = buildWorkoutData(parsed);

			const [inserted] = await db.insert(sensorEvents).values({
				userId: user.id,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: parsed.startTime,
				data,
				metadata: { ...metadata, sourceName: attachment.Name }
			}).onConflictDoUpdate({
				target: [sensorEvents.sensorId, sensorEvents.dataType, sensorEvents.timestamp],
				targetWhere: sql`data_type NOT IN ('bank_balance', 'bank_transaction')`,
				set: {
					data: sql`excluded.data`,
					metadata: sql`excluded.metadata`
				}
			}).returning({ id: sensorEvents.id });

			if (inserted?.id) importedWorkoutIds.push(inserted.id);
			imported += 1;
		} catch (error) {
			failed += 1;
			console.error('[email-inbound] import failed for attachment:', attachment.Name, error);
		}
	}

	await db.update(sensors)
		.set({ lastSync: new Date(), updatedAt: new Date() })
		.where(eq(sensors.id, sensor.id));

	// Send push-varsel med direktelenke til detaljside
	if (importedWorkoutIds.length > 0) {
		const appUrl = new URL(request.url).origin;
		const importedWorkouts = (
			await Promise.all(importedWorkoutIds.map((id) => getWorkoutContextForUser(user.id, id)))
		).filter((w): w is NonNullable<typeof w> => w !== null);

		await notifyUserAboutImportedWorkouts({
			userId: user.id,
			appUrl,
			workouts: importedWorkouts
		}).catch((err) => console.error('[email-inbound] notification failed:', err));
	}

	return json({ success: true, imported, failed });
};
