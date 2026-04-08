import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { sensors, sensorEvents, users } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
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

function buildWorkoutData(parsed: ParsedWorkout) {
	const paceSecondsPerKm = parsed.distance > 0
		? parsed.duration / (parsed.distance / 1000)
		: undefined;

	const sampledTrack = parsed.trackPoints.slice(0, 500).map((p) => ({
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
