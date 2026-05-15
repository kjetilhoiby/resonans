import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { v2 as cloudinary } from 'cloudinary';
import { getAppConfig, type ExternalAppConfig } from '$lib/server/app-registry';
import { parseWorkoutFile } from '$lib/server/integrations/dropbox-sync';
import { SensorEventService } from '$lib/server/services/sensor-event-service';

const WORKOUT_EXTENSIONS = new Set(['.gpx', '.tcx']);
const IMAGE_MIME_PREFIXES = ['image/'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

function getFileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isWorkoutFile(file: File): boolean {
	return WORKOUT_EXTENSIONS.has(getFileExtension(file.name));
}

function isImageFile(file: File): boolean {
	return IMAGE_MIME_PREFIXES.some((p) => file.type.startsWith(p));
}

async function uploadToCloudinary(file: File, appId: string): Promise<{ url: string; publicId: string }> {
	cloudinary.config({
		cloud_name: env.CLOUDINARY_CLOUD_NAME,
		api_key: env.CLOUDINARY_API_KEY,
		api_secret: env.CLOUDINARY_API_SECRET
	});

	const arrayBuffer = await file.arrayBuffer();
	const base64 = Buffer.from(arrayBuffer).toString('base64');
	const dataURI = `data:${file.type};base64,${base64}`;

	const result = await cloudinary.uploader.upload(dataURI, {
		folder: `resonans/apps/${appId}`,
		resource_type: 'auto',
		transformation: [
			{ width: 2048, height: 2048, crop: 'limit' },
			{ quality: 'auto:good' },
			{ fetch_format: 'auto' }
		]
	});

	return { url: result.secure_url, publicId: result.public_id };
}

async function getOrCreateSensor(userId: string, app: ExternalAppConfig): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, app.sensorProvider)
		)
	});

	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: app.sensorProvider,
			type: app.sensorType,
			subtype: app.sensorSubtype,
			name: app.label,
			isActive: true
		})
		.returning();

	return created.id;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const formData = await request.formData();
	const appId = formData.get('app') as string | null;
	const file = formData.get('file') as File | null;
	const sessionId = formData.get('sessionId') as string | null;

	if (!appId) throw error(400, 'Missing app field');

	const app = getAppConfig(appId);
	if (!app) throw error(404, `Unknown app: ${appId}`);

	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	const sensorId = await getOrCreateSensor(userId, app);

	try {
		if (isWorkoutFile(file)) {
			return await handleWorkoutUpload(file, { userId, sensorId, app, sessionId, formData });
		}

		if (isImageFile(file)) {
			return await handleImageUpload(file, { userId, sensorId, app, sessionId, formData });
		}

		return json({ error: `Unsupported file type: ${file.type || getFileExtension(file.name)}` }, { status: 400 });
	} catch (err) {
		console.error(`App upload failed (${app.id}):`, err);
		return json(
			{ error: err instanceof Error ? err.message : 'Upload failed' },
			{ status: 500 }
		);
	}
};

async function handleWorkoutUpload(
	file: File,
	ctx: { userId: string; sensorId: string; app: ExternalAppConfig; sessionId: string | null; formData: FormData }
) {
	const sportType = ctx.formData.get('sportType') as string | null;
	const gpxContent = await file.text();
	const parsed = parseWorkoutFile(file.name || 'track.gpx', gpxContent);

	if (!parsed) {
		return json({ error: 'Failed to parse workout file' }, { status: 400 });
	}

	if (sportType) {
		parsed.sportType = sportType;
	}

	const result = await SensorEventService.write(
		{
			userId: ctx.userId,
			sensorId: ctx.sensorId,
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
				paceSecondsPerKm:
					parsed.distance > 0
						? parsed.duration / (parsed.distance / 1000)
						: undefined,
				trackPoints: parsed.trackPoints.slice(0, 500)
			},
			metadata: {
				sourceApp: ctx.app.id,
				sourceFormat: getFileExtension(file.name).slice(1),
				totalTrackPoints: parsed.trackPoints.length,
				sessionId: ctx.sessionId
			},
			dedupeKey: ctx.sessionId ? `${ctx.app.id}::${ctx.sessionId}` : undefined,
			source: `${ctx.app.id}_upload`
		},
		{ conflictMode: 'upsert_sensor_datatype_timestamp' }
	);

	return json({
		ok: true,
		type: 'workout',
		eventId: result.event?.id,
		inserted: result.inserted,
		trackPoints: parsed.trackPoints.length,
		distance: Math.round(parsed.distance),
		duration: Math.round(parsed.duration)
	});
}

async function handleImageUpload(
	file: File,
	ctx: { userId: string; sensorId: string; app: ExternalAppConfig; sessionId: string | null; formData: FormData }
) {
	if (file.size > MAX_IMAGE_SIZE) {
		return json({ error: `File too large (max ${MAX_IMAGE_SIZE / 1024 / 1024} MB)` }, { status: 400 });
	}

	if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
		return json({ error: 'Image storage not configured' }, { status: 500 });
	}

	const eventType = (ctx.formData.get('eventType') as string) || 'observation';
	const dataType = (ctx.formData.get('dataType') as string) || 'image';
	const caption = ctx.formData.get('caption') as string | null;

	const { url, publicId } = await uploadToCloudinary(file, ctx.app.id);

	const result = await SensorEventService.write(
		{
			userId: ctx.userId,
			sensorId: ctx.sensorId,
			eventType,
			dataType,
			timestamp: new Date(),
			data: {
				imageUrl: url,
				cloudinaryPublicId: publicId,
				mimeType: file.type,
				fileName: file.name,
				sizeBytes: file.size,
				caption: caption
			},
			metadata: {
				sourceApp: ctx.app.id,
				sourceFormat: 'image',
				sessionId: ctx.sessionId
			},
			dedupeKey: ctx.sessionId ? `${ctx.app.id}::${ctx.sessionId}` : undefined,
			source: `${ctx.app.id}_upload`
		},
		{ conflictMode: 'upsert_sensor_datatype_timestamp' }
	);

	return json({
		ok: true,
		type: 'image',
		eventId: result.event?.id,
		inserted: result.inserted,
		imageUrl: url
	});
}
