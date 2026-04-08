import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

interface ActivityLayerOptions {
	since?: Date;
	limit?: number;
}

export interface CanonicalActivityFeedItem {
	activityId: string;
	/** 'workout' = deduplisert/sammenslått treningsøkt · 'activity' = annen hendelse (dato, manuell registrering, etc.) */
	kind: 'workout' | 'activity';
	timestamp: string;
	title: string;
	summary: string | null;
	dataType: string;
	sourceProviders: string[];
	sourceCount: number;
	hasManualEvidence: boolean;
	payload: Record<string, unknown>;
	workout?: UnifiedWorkoutActivity;
}

interface WorkoutEvidenceEvent {
	id: string;
	sensorId: string;
	timestamp: Date;
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
	provider: string;
	sensorType: string;
	priority: number;
}

export interface WorkoutEvidence {
	eventId: string;
	sensorId: string;
	provider: string;
	sensorType: string;
	timestamp: string;
	hasDistance: boolean;
	hasDuration: boolean;
	hasHeartRate: boolean;
	hasTrackPoints: boolean;
	hasImageEvidence: boolean;
	imageUrl?: string;
	notes?: string;
	// Råverdier fra denne kilden — brukes til å vise kilde-vs-kilde-sammenligning
	distanceMeters: number | null;
	durationSeconds: number | null;
	avgHeartRate: number | null;
}

export interface UnifiedWorkoutActivity {
	activityId: string;
	startTime: string;
	sportType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	sources: string[];
	evidenceCount: number;
	hasManualEvidence: boolean;
	hasHeartRateEvidence: boolean;
	notes: string[];
	evidence: WorkoutEvidence[];
}

function normalizeSportType(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) return 'workout';
	return value.trim().toLowerCase();
}

function titleize(value: string): string {
	return value
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function formatMinutes(totalMinutes: number): string {
	if (totalMinutes < 60) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (minutes === 0) return `${hours} t`;
	return `${hours} t ${minutes} min`;
}

function formatWorkoutSummary(activity: UnifiedWorkoutActivity): string | null {
	const parts: string[] = [];
	if (typeof activity.distanceMeters === 'number' && activity.distanceMeters > 0) {
		parts.push(`${(activity.distanceMeters / 1000).toFixed(1)} km`);
	}
	if (typeof activity.durationSeconds === 'number' && activity.durationSeconds > 0) {
		parts.push(formatMinutes(Math.round(activity.durationSeconds / 60)));
	}
	if (typeof activity.avgHeartRate === 'number' && activity.avgHeartRate > 0) {
		parts.push(`${Math.round(activity.avgHeartRate)} bpm`);
	}
	return parts.length > 0 ? parts.join(' · ') : null;
}

function summarizeEvent(dataType: string | null, data: Record<string, unknown>): string | null {
	if (typeof data.note === 'string' && data.note.trim()) {
		return data.note.trim();
	}
	if (typeof data.notes === 'string' && data.notes.trim()) {
		return data.notes.trim();
	}
	return null;
}

function titleForEvent(dataType: string | null, data: Record<string, unknown>): string {
	const originalType = typeof data.originalActivityType === 'string' ? data.originalActivityType : null;
	const effectiveType = originalType ?? dataType ?? 'activity';
	return titleize(effectiveType);
}

function sportFamily(value: string): string {
	if (value.includes('running')) return 'running';
	if (value.includes('cycling') || value === 'e_bike') return 'cycling';
	if (value.includes('walking') || value === 'hiking') return 'walking';
	if (value.includes('swimming')) return 'swimming';
	return value;
}

function normalizeDistanceMeters(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value > 80 ? value : value * 1000;
}

function normalizeDurationSeconds(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value;
}

function normalizeHeartRate(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value;
}

function sourcePriority(provider: string, sensorType: string): number {
	if (provider === 'ai_assistant' || sensorType === 'manual_log') return 5;
	if (provider === 'dropbox' || sensorType === 'workout_files') return 4;
	if (provider === 'withings') return 3;
	return 1;
}

function choosePreferredNumeric(
	events: WorkoutEvidenceEvent[],
	valueFrom: (event: WorkoutEvidenceEvent) => number | null
): number | null {
	const candidates = events
		.map((event) => ({ event, value: valueFrom(event) }))
		.filter((candidate): candidate is { event: WorkoutEvidenceEvent; value: number } => candidate.value !== null);

	if (candidates.length === 0) return null;

	const topPriority = Math.max(...candidates.map((candidate) => candidate.event.priority));
	const top = candidates.filter((candidate) => candidate.event.priority === topPriority);
	return Math.max(...top.map((candidate) => candidate.value));
}

function buildEvidence(event: WorkoutEvidenceEvent): WorkoutEvidence {
	const hasTrackPoints = Array.isArray(event.data.trackPoints)
		? event.data.trackPoints.length > 0
		: typeof event.metadata.totalTrackPoints === 'number' && event.metadata.totalTrackPoints > 0;
	const imageUrl =
		typeof event.data.sourceImageUrl === 'string'
			? event.data.sourceImageUrl
			: typeof event.data.imageUrl === 'string'
				? event.data.imageUrl
				: typeof event.metadata.sourceImageUrl === 'string'
					? event.metadata.sourceImageUrl
					: undefined;
	const notesValue = typeof event.data.notes === 'string' ? event.data.notes : undefined;
	const distanceMeters = normalizeDistanceMeters(event.data.distance);
	const durationSeconds = normalizeDurationSeconds(event.data.duration);
	const avgHeartRate =
		normalizeHeartRate(event.data.avgHeartRate) ??
		normalizeHeartRate(event.data.heartRate);
	return {
		eventId: event.id,
		sensorId: event.sensorId,
		provider: event.provider,
		sensorType: event.sensorType,
		timestamp: event.timestamp.toISOString(),
		hasDistance: distanceMeters !== null,
		hasDuration: durationSeconds !== null,
		hasHeartRate:
			normalizeHeartRate(event.data.avgHeartRate) !== null ||
			normalizeHeartRate(event.data.maxHeartRate) !== null ||
			normalizeHeartRate(event.data.heartRate) !== null,
		hasTrackPoints,
		hasImageEvidence: Boolean(imageUrl),
		imageUrl,
		notes: notesValue,
		distanceMeters,
		durationSeconds,
		avgHeartRate
	};
}

export async function buildUnifiedWorkoutActivities(
	userId: string,
	options: ActivityLayerOptions = {}
): Promise<UnifiedWorkoutActivity[]> {
	const conditions = [eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'workout')];
	if (options.since) {
		conditions.push(gte(sensorEvents.timestamp, options.since));
	}

	const workoutEvents = await db.query.sensorEvents.findMany({
		where: and(...conditions),
		orderBy: (events, { asc }) => [asc(events.timestamp)],
		limit: options.limit ?? 1000
	});

	if (workoutEvents.length === 0) return [];

	const sensorIds = [...new Set(workoutEvents.map((event) => event.sensorId))];
	const sensorRows = await db.query.sensors.findMany({
		where: and(eq(sensors.userId, userId)),
		columns: { id: true, provider: true, type: true }
	});
	const sensorMap = new Map(sensorRows.map((sensor) => [sensor.id, sensor]));

	const normalizedEvents: WorkoutEvidenceEvent[] = workoutEvents.map((event) => {
		const sensor = sensorMap.get(event.sensorId);
		const provider = sensor?.provider ?? 'unknown';
		const sensorType = sensor?.type ?? 'unknown';
		return {
			id: event.id,
			sensorId: event.sensorId,
			timestamp: event.timestamp,
			data: (event.data ?? {}) as Record<string, unknown>,
			metadata: (event.metadata ?? {}) as Record<string, unknown>,
			provider,
			sensorType,
			priority: sourcePriority(provider, sensorType)
		};
	});

	const clusterWindowMs = 2 * 60 * 60 * 1000;
	const clusters: Array<{ sportFamily: string; startTime: Date; events: WorkoutEvidenceEvent[] }> = [];

	for (const event of normalizedEvents) {
		const sport = normalizeSportType(event.data.sportType);
		const family = sportFamily(sport);
		let matchIndex = -1;
		let bestDelta = Number.POSITIVE_INFINITY;

		for (let i = clusters.length - 1; i >= 0; i -= 1) {
			const cluster = clusters[i];
			if (cluster.sportFamily !== family) continue;
			const delta = Math.abs(event.timestamp.getTime() - cluster.startTime.getTime());
			if (delta <= clusterWindowMs && delta < bestDelta) {
				bestDelta = delta;
				matchIndex = i;
			}
		}

		if (matchIndex >= 0) {
			clusters[matchIndex].events.push(event);
			if (event.timestamp < clusters[matchIndex].startTime) {
				clusters[matchIndex].startTime = event.timestamp;
			}
		} else {
			clusters.push({
				sportFamily: family,
				startTime: event.timestamp,
				events: [event]
			});
		}
	}

	const unified = clusters
		.map((cluster): UnifiedWorkoutActivity => {
			const events = cluster.events;
			const distanceMeters = choosePreferredNumeric(events, (event) => normalizeDistanceMeters(event.data.distance));
			const durationSeconds = choosePreferredNumeric(events, (event) => normalizeDurationSeconds(event.data.duration));
			const paceSecondsPerKm =
				choosePreferredNumeric(events, (event) =>
					typeof event.data.paceSecondsPerKm === 'number' ? event.data.paceSecondsPerKm : null
				) ??
				(distanceMeters && durationSeconds && distanceMeters > 0
					? durationSeconds / (distanceMeters / 1000)
					: null);

			const avgHeartRate = choosePreferredNumeric(events, (event) => normalizeHeartRate(event.data.avgHeartRate));
			const maxHeartRate = choosePreferredNumeric(events, (event) => normalizeHeartRate(event.data.maxHeartRate));
			const elevationMeters = choosePreferredNumeric(events, (event) =>
				typeof event.data.elevation === 'number' && Number.isFinite(event.data.elevation)
					? event.data.elevation
					: null
			);

			const notes = events
				.map((event) => (typeof event.data.notes === 'string' ? event.data.notes.trim() : ''))
				.filter((note) => note.length > 0);

			const sportTypes = events
				.map((event) => normalizeSportType(event.data.sportType))
				.filter((value) => value !== 'workout');
			const sportType = sportTypes.length > 0 ? sportTypes[0] : cluster.sportFamily;

			const sourceSet = [...new Set(events.map((event) => event.provider))];
			const hasManualEvidence = events.some(
				(event) => event.provider === 'ai_assistant' || event.sensorType === 'manual_log'
			);
			const hasHeartRateEvidence = events.some(
				(event) =>
					normalizeHeartRate(event.data.avgHeartRate) !== null ||
					normalizeHeartRate(event.data.maxHeartRate) !== null ||
					normalizeHeartRate(event.data.heartRate) !== null
			);

			return {
				activityId: events[0].id,
				startTime: cluster.startTime.toISOString(),
				sportType,
				distanceMeters,
				durationSeconds,
				paceSecondsPerKm,
				elevationMeters,
				avgHeartRate,
				maxHeartRate,
				sources: sourceSet,
				evidenceCount: events.length,
				hasManualEvidence,
				hasHeartRateEvidence,
				notes,
				evidence: events.map(buildEvidence)
			};
		})
		.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

	return unified;
}

export async function buildCanonicalActivityFeed(
	userId: string,
	options: ActivityLayerOptions = {}
): Promise<CanonicalActivityFeedItem[]> {
	const conditions = [eq(sensorEvents.userId, userId)];
	if (options.since) {
		conditions.push(gte(sensorEvents.timestamp, options.since));
	}

	const [workouts, events, sensorRows] = await Promise.all([
		buildUnifiedWorkoutActivities(userId, options),
		db.query.sensorEvents.findMany({
			where: and(...conditions),
			orderBy: (eventRows, { desc }) => [desc(eventRows.timestamp)],
			limit: options.limit ?? 1000
		}),
		db.query.sensors.findMany({
			where: and(eq(sensors.userId, userId)),
			columns: { id: true, provider: true, type: true }
		})
	]);

	const workoutEventIds = new Set(workouts.flatMap((workout) => workout.evidence.map((evidence) => evidence.eventId)));
	const sensorMap = new Map(sensorRows.map((sensor) => [sensor.id, sensor]));

	const feed: CanonicalActivityFeedItem[] = workouts.map((workout) => ({
		activityId: workout.activityId,
		kind: 'workout',
		timestamp: workout.startTime,
		title: titleize(workout.sportType),
		summary: formatWorkoutSummary(workout),
		dataType: 'workout',
		sourceProviders: workout.sources,
		sourceCount: workout.evidenceCount,
		hasManualEvidence: workout.hasManualEvidence,
		payload: {
			sportType: workout.sportType,
			distanceMeters: workout.distanceMeters,
			durationSeconds: workout.durationSeconds,
			avgHeartRate: workout.avgHeartRate,
			maxHeartRate: workout.maxHeartRate,
			evidenceCount: workout.evidenceCount
		},
		workout
	}));

	for (const event of events) {
		// Bare hendelser (eventType='activity') er med i feeden.
		// Observasjoner (eventType='measurement') som mood, screen_time, vekt etc.
		// er målinger og hentes fra sensor-aggregater/widget-data-laget.
		if (event.eventType !== 'activity') continue;
		if (workoutEventIds.has(event.id)) continue;

		const sensor = sensorMap.get(event.sensorId);
		const data = (event.data ?? {}) as Record<string, unknown>;
		const dataType = event.dataType ?? event.eventType;
		const provider = sensor?.provider ?? 'unknown';
		const sensorType = sensor?.type ?? 'unknown';
		const hasManualEvidence = provider === 'ai_assistant' || sensorType === 'manual_log';

		feed.push({
			activityId: event.id,
			kind: 'activity',
			timestamp: event.timestamp.toISOString(),
			title: titleForEvent(event.dataType, data),
			summary: summarizeEvent(event.dataType, data),
			dataType,
			sourceProviders: [provider],
			sourceCount: 1,
			hasManualEvidence,
			payload: data
		});
	}

	return feed
		.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
		.slice(0, options.limit ?? 1000);
}