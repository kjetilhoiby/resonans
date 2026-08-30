import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { v2 as cloudinary } from 'cloudinary';
import { getAppConfig, type ExternalAppConfig } from '$lib/server/app-registry';
import { parseWorkoutFile, downsampleTrack, forgottenTrackingSuggestionFor, MAX_STORED_TRACK_POINTS } from '$lib/server/integrations/dropbox-sync';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { normalizeSportType, describeWorkoutSportType } from '$lib/server/workout-taxonomy';
import { pushSession } from '$lib/server/services/strava-sync-service';
import { runAfterWorkoutWrite } from '$lib/server/workouts/after-workout-write';
import { runInBackground } from '$lib/server/run-in-background';
import { isWorkoutSuppressedForUser } from '$lib/server/workouts/workout-suppressions';
import { parseWorkoutAnalysis } from '$lib/domain/health/workout-analysis';

const WORKOUT_EXTENSIONS = new Set(['.gpx', '.tcx']);
const IMAGE_MIME_PREFIXES = ['image/'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

function formatWorkoutDate(date: Date): string {
	try {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
}

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

export const POST: RequestHandler = async ({ locals, request, url }) => {
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
			return await handleWorkoutUpload(file, { userId, sensorId, app, sessionId, formData, appUrl: url.origin });
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
	ctx: {
		userId: string;
		sensorId: string;
		app: ExternalAppConfig;
		sessionId: string | null;
		formData: FormData;
		appUrl: string;
	}
) {
	const sportType = ctx.formData.get('sportType') as string | null;
	// Klienten kan be om Resonans-only (hopp over Strava-auto-push) — brukes når en økt lastes
	// opp manuelt til Resonans, men bevisst holdes utenfor Strava (f.eks. tvilsomme GPS-spor).
	const skipStrava = ctx.formData.get('skipStrava') === 'true';
	// Rute-attribusjon: Ekko tagger økta med rutens id → balanse-rotasjon slår opp navnet.
	const ekkoRouteId = (ctx.formData.get('routeId') as string | null)?.trim() || null;
	// Foretrukket kartlag ved deling ('topo' | 'sat'): valgt i Ekko når turen deles,
	// brukt som standard i web-avspillingen. Valgfritt.
	const basemapRaw = (ctx.formData.get('basemap') as string | null)?.trim() || null;
	const preferredBasemap = basemapRaw === 'topo' || basemapRaw === 'sat' ? basemapRaw : null;
	// Øktanalyse fra Ekko (valgfri): navngitte bakker, strekk og baner med brukerens
	// egen historikk, pluss rundetider og bakkedrag. Det serveren IKKE kan utlede av
	// sporet — se $lib/domain/health/workout-analysis.ts og docs/ekko-oktanalyse.md.
	// Feiler tolkningen, lagres økta uten analyse: GPX-en er det viktige.
	const { analysis, warnings: analysisWarnings } = parseWorkoutAnalysis(
		ctx.formData.get('analysis')
	);
	if (analysisWarnings.length > 0) {
		console.warn(
			`[apps/upload] øktanalyse fra ${ctx.app.id} delvis forkastet: ${analysisWarnings.join('; ')}`
		);
	}
	const gpxContent = await file.text();
	const parsed = parseWorkoutFile(file.name || 'track.gpx', gpxContent);

	if (!parsed) {
		return json({ error: 'Failed to parse workout file' }, { status: 400 });
	}

	if (sportType) {
		parsed.sportType = sportType;
	}
	// Normaliser sportType (f.eks. Ekko sender «eBiking») til kanonisk form
	// slik at autocheck/effort/analyse kjenner den igjen.
	parsed.sportType = normalizeSportType(parsed.sportType);

	// Etter normaliseringen, ikke før: terskelen for «i bevegelse» er per
	// sportsfamilie, og en el-sykkeltur parset som «running» ville fått feil.
	//
	// Dette ENDRER ingenting. Økta lagres som den ble spilt inn; forslaget er noe
	// Ekko kan vise, og brukeren kan handle på ved å kutte lokalt og laste opp på
	// nytt. Se docs/ekko-glemte-trackeren.md.
	const forgottenTracking = forgottenTrackingSuggestionFor(parsed);

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
				trackPoints: downsampleTrack(parsed.trackPoints, MAX_STORED_TRACK_POINTS),
				...(preferredBasemap ? { preferredBasemap } : {}),
				...(analysis ? { ekkoAnalysis: analysis } : {})
			},
			metadata: {
				sourceApp: ctx.app.id,
				sourceFormat: getFileExtension(file.name).slice(1),
				totalTrackPoints: parsed.trackPoints.length,
				sessionId: ctx.sessionId,
				...(ekkoRouteId ? { ekkoRouteId } : {})
			},
			dedupeKey: ctx.sessionId ? `${ctx.app.id}::${ctx.sessionId}` : undefined,
			source: `${ctx.app.id}_upload`
		},
		{ conflictMode: 'upsert_sensor_datatype_timestamp' }
	);

	// Etterbehandling: aggregater, autohaking, målprogresjon og push. Dette lå
	// fram til august 2026 bare i Withings- og Dropbox-synken, så en tur lastet
	// opp fra Ekko ble usynlig i formkurven til nattjobben og ga aldri varsel —
	// se docs/changelog/2026-08-10-en-vei-inn-for-nye-okter.md.
	//
	// `runInBackground` (waitUntil) holder funksjonen i live til jobben er ferdig
	// uten å forsinke svaret til Ekko: appen venter på dette kallet før den kan
	// merke økta som opplastet.
	if (result.event?.id) {
		runInBackground(
			runAfterWorkoutWrite({
				userId: ctx.userId,
				eventIds: [result.event.id],
				timestamps: [parsed.startTime],
				appUrl: ctx.appUrl,
				source: `${ctx.app.id}_upload`
			})
		);
	}

	// Er økta svartelistet, er den lagret men skjult. Raden skrives fortsatt —
	// skrivestien skal være additiv og idempotent, og et avvist opplastingssvar
	// ville sett ut som en feil i Ekko — men alt som rekker UT av Resonans må
	// stoppe her. `runAfterWorkoutWrite` over er trygt: varsling og autohaking
	// går gjennom aktivitetslaget, som filtrerer svartelistede klynger.
	const suppressed = await isWorkoutSuppressedForUser(
		ctx.userId,
		parsed.startTime,
		parsed.sportType
	).catch(() => false);

	// Auto-push til Strava hvis brukeren er koblet til. pushSession er dedup-et
	// (external_id = `<app>-<sessionId>`) og feiler aldri hardt — den bokfører
	// utfallet på Strava-koblingen i stedet for å velte ekkos opplastingssvar.
	// Krever sessionId (brukes til dedup) og at økten faktisk ble lagret.
	// `!suppressed`: en skjult økt skal ikke publiseres til Strava. Det er den ene
	// bivirkningen brukeren ikke kan angre fra Resonans, og en økt hen har sagt at
	// ikke skjedde, hører ikke på en offentlig treningsprofil.
	if (ctx.sessionId && result.event?.id && !skipStrava && !suppressed) {
		try {
			await pushSession({
				userId: ctx.userId,
				appId: ctx.app.id,
				sessionId: ctx.sessionId,
				gpx: gpxContent,
				sportType: parsed.sportType,
				name: `${describeWorkoutSportType(parsed.sportType)} — ${formatWorkoutDate(parsed.startTime)}`,
				sensorEventId: result.event.id
			});
		} catch (err) {
			console.error('Strava auto-push feilet (ignorert):', err);
		}
	}

	return json({
		ok: true,
		type: 'workout',
		eventId: result.event?.id,
		inserted: result.inserted,
		trackPoints: parsed.trackPoints.length,
		distance: Math.round(parsed.distance),
		duration: Math.round(parsed.duration),
		// Økta er lagret, men skjult fordi brukeren har svartelistet den. Uten
		// dette feltet ser opplastingen helt vanlig ut for Ekko, og appen ville
		// vist en økt som ikke finnes noe sted i Resonans. `hidden` betyr ikke at
		// noe gikk galt — se docs/ekko-skjul-okt.md.
		hidden: suppressed,
		// null i det store flertallet av tilfellene. Er den satt, ser det ut som
		// sporingen ble glemt, og Ekko kan tilby «snapp sluttpunktet hit».
		forgottenTracking,
		// Hva vi faktisk tok imot av analysen. Uten dette er et avvist felt usynlig
		// for appen og ser ut som at Resonans ignorerer den — samme grunn som
		// `warnings` på HealthKit-importen.
		analysis: analysis
			? { features: analysis.features.length, laps: analysis.laps.length, hillReps: analysis.hillReps.length }
			: null,
		...(analysisWarnings.length > 0 ? { analysisWarnings } : {})
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
	// Fotoets tid/sted (fra Ekko): brukes til å plassere bildet langs turens spor
	// i 3D-avspilling og kartfortelling. Alle valgfrie.
	const capturedAt = (ctx.formData.get('capturedAt') as string | null)?.trim() || null;
	const latRaw = ctx.formData.get('lat') as string | null;
	const lonRaw = ctx.formData.get('lon') as string | null;
	const lat = latRaw != null && latRaw !== '' && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
	const lon = lonRaw != null && lonRaw !== '' && Number.isFinite(Number(lonRaw)) ? Number(lonRaw) : null;

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
				caption: caption,
				...(capturedAt ? { capturedAt } : {}),
				...(lat != null ? { lat } : {}),
				...(lon != null ? { lon } : {})
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
