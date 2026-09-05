import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { isWorkoutSuppressed } from '$lib/domain/health/workout-suppression';
import { listWorkoutSuppressions } from '$lib/server/workouts/workout-suppressions';
import {
	MIN_USABLE_TRACK_POINTS,
	pickTrackSource
} from '$lib/domain/health/track-source';

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
	/** Når raden ble skrevet. Avgjør hvilken versjon som gjelder når én sensor har flere. */
	createdAt: Date;
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
	provider: string;
	sensorType: string;
	priority: number;
	hasTrackPoints: boolean;
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

/**
 * Familien KLYNGINGEN bruker — og dermed den svartelista må bruke.
 *
 * NB: dette er ikke `workoutSportFamily` fra `$lib/domain/health/workout-sport`,
 * og de er ikke enige: `hill` blir 'running' her og 'hill' der, mens `løp` blir
 * 'løp' her og 'running' der. At de to finnes side om side er en kjent rest (se
 * filhodet i workout-sport.ts), men så lenge de gjør det, må alt som skal matche
 * en klynge bruke NØYAKTIG denne. Skriver man en svartelisting med den ene og
 * filtrerer med den andre, treffer den aldri — og det er en stille feil, ikke en
 * feilmelding.
 */
export function clusterSportFamily(value: string): string {
	if (value.includes('running') || value === 'hill') return 'running';
	if (value.includes('cycling') || value === 'e_bike' || value.includes('ebik')) return 'cycling';
	if (value.includes('walking') || value === 'hiking') return 'walking';
	if (value.includes('swimming')) return 'swimming';
	return value;
}

/**
 * Distanse i meter. Verdier ≤ 80 tolkes som kilometer — noen kilder sender km.
 * Eksportert fordi skjulte-økter-lista må vise det SAMME tallet som feeden;
 * en tredje kopi av regelen ville før eller siden ment noe annet.
 */
export function normalizeDistanceMeters(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value > 80 ? value : value * 1000;
}

/**
 * Distansen fra en `canonical_workouts`-rad, i meter.
 *
 * **Ikke `normalizeDistanceMeters`.** Den hører til RÅ sensor-events, der noen
 * kilder skriver kilometer i et felt som heter meter, og tolker derfor verdier
 * ≤ 80 som kilometer. Canonical er skrevet FRA den funksjonen og inneholder
 * ekte meter — kjører man heuristikken en gang til, blir en søppelrad på 53
 * meter til 53 kilometer.
 *
 * Det var ikke teoretisk: en slik rad fikk den akkumulerte løpekurven til å
 * starte 53 km oppe i lufta på dag 1, og i streak-kalenderen ble den samme
 * raden dagens raskeste tempo (sekunder delt på 53 km).
 *
 * Kolonnen er `decimal`, altså en streng fra driveren, så konverteringen hører
 * hjemme her framfor på hvert kallsted.
 */
export function canonicalDistanceMeters(value: unknown): number | null {
	const meters = Number(value);
	if (!Number.isFinite(meters) || meters <= 0) return null;
	return meters;
}

function normalizeDurationSeconds(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value;
}

function normalizeHeartRate(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value;
}

/**
 * Klyngevinduet. Samme tur skrevet av klokka, en fil og appen spriker
 * minutter i starttid; to timer er slingringsmonnet hele aktivitetslaget
 * bruker, og sporvalget må bruke NØYAKTIG det samme — et eget tall her ville
 * gitt et kart fra en klynge lista ikke mener finnes.
 */
export const CLUSTER_WINDOW_MS = 2 * 60 * 60 * 1000;

export function sourcePriority(provider: string, sensorType: string): number {
	if (provider === 'ai_assistant' || sensorType === 'manual_log') return 5;
	if (sensorType === 'gps_device' || provider === 'dropbox' || sensorType === 'workout_files') return 4;
	if (provider === 'withings') return 3;
	return 1;
}

/** Kilden brukeren har utpekt som vinner for et felt (GPS eller puls), eller null. */
function preferredEventFor(
	events: WorkoutEvidenceEvent[],
	flag: 'preferGps' | 'preferHr'
): WorkoutEvidenceEvent | null {
	return events.find((e) => e.metadata[flag] === true || e.metadata[flag] === 'true') ?? null;
}

/**
 * Velger feltverdi med manuell overstyring først: er en kilde utpekt som vinner for feltets rolle
 * (GPS/puls) og har en verdi, brukes den. Ellers faller vi tilbake på prioritet-så-verdi.
 */
function pickNumericField(
	events: WorkoutEvidenceEvent[],
	valueFrom: (event: WorkoutEvidenceEvent) => number | null,
	flag: 'preferGps' | 'preferHr'
): number | null {
	const forced = preferredEventFor(events, flag);
	if (forced) {
		const value = valueFrom(forced);
		if (value !== null) return value;
	}
	return choosePreferredNumeric(events, valueFrom);
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

/**
 * Én registrering per sensor i en klynge — den nyest skrevne.
 *
 * **To hendelser fra samme sensor i samme klynge er to versjoner av samme
 * opptak, ikke to kilder.** Klyngen ER aktiviteten; en sensor som har skrevet
 * to rader innenfor vinduet har rettet seg selv.
 *
 * Uten dette avgjorde `choosePreferredNumeric`, som tar den STØRSTE verdien blant
 * kildene med høyest prioritet. En bruker som kuttet en glemt sporing i Ekko fra
 * 2 t 20 min til 24 min fikk derfor fortsatt 2 t 20 min på flaten: den gamle
 * raden var lengst, og lengst vant. Rettingen så ut som den ikke gjorde noe.
 *
 * «Nyest skrevet» og ikke «kortest»: en korreksjon kan gå begge veier, og det
 * eneste vi vet sikkert er hvilken versjon som kom sist.
 */
function latestPerSensor(events: WorkoutEvidenceEvent[]): WorkoutEvidenceEvent[] {
	const bySensor = new Map<string, WorkoutEvidenceEvent>();
	for (const event of events) {
		const existing = bySensor.get(event.sensorId);
		if (!existing || event.createdAt > existing.createdAt) {
			bySensor.set(event.sensorId, event);
		}
	}
	return events.filter((event) => bySensor.get(event.sensorId) === event);
}

function buildEvidence(event: WorkoutEvidenceEvent): WorkoutEvidence {
	const hasTrackPoints = event.hasTrackPoints
		|| (typeof event.metadata.totalTrackPoints === 'number' && event.metadata.totalTrackPoints > 0);
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
	const t0 = performance.now();
	const conditions = [
		eq(sensorEvents.userId, userId),
		eq(sensorEvents.dataType, 'workout')
	];
	if (options.since) {
		conditions.push(gte(sensorEvents.timestamp, options.since));
	}

	const workoutEvents = await db
		.select({
			id: sensorEvents.id,
			userId: sensorEvents.userId,
			sensorId: sensorEvents.sensorId,
			eventType: sensorEvents.eventType,
			dataType: sensorEvents.dataType,
			timestamp: sensorEvents.timestamp,
			createdAt: sensorEvents.createdAt,
			data: sql<Record<string, unknown>>`jsonb_build_object(
				'sportType', ${sensorEvents.data}->'sportType',
				'distance', ${sensorEvents.data}->'distance',
				'duration', ${sensorEvents.data}->'duration',
				'paceSecondsPerKm', ${sensorEvents.data}->'paceSecondsPerKm',
				'avgHeartRate', ${sensorEvents.data}->'avgHeartRate',
				'maxHeartRate', ${sensorEvents.data}->'maxHeartRate',
				'heartRate', ${sensorEvents.data}->'heartRate',
				'elevation', ${sensorEvents.data}->'elevation',
				'notes', ${sensorEvents.data}->'notes',
				'sourceImageUrl', ${sensorEvents.data}->'sourceImageUrl',
				'imageUrl', ${sensorEvents.data}->'imageUrl'
			)`,
			metadata: sql<Record<string, unknown>>`jsonb_build_object(
				'totalTrackPoints', ${sensorEvents.metadata}->'totalTrackPoints',
				'sourceImageUrl', ${sensorEvents.metadata}->'sourceImageUrl',
				'dismissed', ${sensorEvents.metadata}->'dismissed',
				'sourceRejected', ${sensorEvents.metadata}->'sourceRejected',
				'preferGps', ${sensorEvents.metadata}->'preferGps',
				'preferHr', ${sensorEvents.metadata}->'preferHr'
			)`,
			hasTrackPoints: sql<boolean>`${sensorEvents.data} ? 'trackPoints'`,
		})
		.from(sensorEvents)
		.where(and(...conditions))
		.orderBy(asc(sensorEvents.timestamp))
		.limit(options.limit ?? 1000);
	console.log(`[activity-layer] sensorEvents query: ${(performance.now() - t0).toFixed(0)}ms → ${workoutEvents.length} rows`);

	if (workoutEvents.length === 0) return [];

	const t1 = performance.now();
	const sensorIds = [...new Set(workoutEvents.map((event) => event.sensorId))];
	const sensorRows = await db.query.sensors.findMany({
		where: inArray(sensors.id, sensorIds),
		columns: { id: true, provider: true, type: true }
	});
	console.log(`[activity-layer] sensors query by id: ${(performance.now() - t1).toFixed(0)}ms → ${sensorRows.length} sensors (${sensorIds.length} requested)`);
	const sensorMap = new Map(sensorRows.map((sensor) => [sensor.id, sensor]));

	const normalizedEvents: WorkoutEvidenceEvent[] = workoutEvents.map((event) => {
		const sensor = sensorMap.get(event.sensorId);
		const provider = sensor?.provider ?? 'unknown';
		const sensorType = sensor?.type ?? 'unknown';
		return {
			id: event.id,
			sensorId: event.sensorId,
			timestamp: event.timestamp,
			createdAt: event.createdAt,
			data: (event.data ?? {}) as Record<string, unknown>,
			metadata: (event.metadata ?? {}) as Record<string, unknown>,
			provider,
			sensorType,
			priority: sourcePriority(provider, sensorType),
			hasTrackPoints: event.hasTrackPoints
		};
	});

	// Svartelista hentes én gang per bygging. Vinduet padder bakover med
	// toleransen, ellers slipper en økt i kanten av `since` gjennom.
	const suppressions = await listWorkoutSuppressions(userId, options.since);

	const clusterWindowMs = CLUSTER_WINDOW_MS;
	const clusters: Array<{ sportFamily: string; startTime: Date; events: WorkoutEvidenceEvent[] }> = [];

	for (const event of normalizedEvents) {
		// Kilde-avviste enkeltregistreringer holdes utenfor klyngingen (event-nivå), så en
		// aktivitet består av sine gjenværende gode kilder. Skiller seg fra `dismissed`, som
		// skjuler HELE økta (klynge-nivå, lenger ned). Avvises alle kilder, forsvinner økta.
		if (event.metadata.sourceRejected === true || event.metadata.sourceRejected === 'true') continue;
		const sport = normalizeSportType(event.data.sportType);
		const family = clusterSportFamily(sport);
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
			const events = latestPerSensor(cluster.events);
			const distanceMeters = pickNumericField(events, (event) => normalizeDistanceMeters(event.data.distance), 'preferGps');
			const durationSeconds = pickNumericField(events, (event) => normalizeDurationSeconds(event.data.duration), 'preferGps');
			const paceSecondsPerKm =
				pickNumericField(events, (event) =>
					typeof event.data.paceSecondsPerKm === 'number' ? event.data.paceSecondsPerKm : null,
				'preferGps') ??
				(distanceMeters && durationSeconds && distanceMeters > 0
					? durationSeconds / (distanceMeters / 1000)
					: null);

			const avgHeartRate = pickNumericField(events, (event) => normalizeHeartRate(event.data.avgHeartRate), 'preferHr');
			const maxHeartRate = pickNumericField(events, (event) => normalizeHeartRate(event.data.maxHeartRate), 'preferHr');
			const elevationMeters = pickNumericField(events, (event) =>
				typeof event.data.elevation === 'number' && Number.isFinite(event.data.elevation)
					? event.data.elevation
					: null,
			'preferGps');

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
		.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
		.filter((w) => {
			// Svartelistet: «denne økta skjedde ikke, uansett kilde». Sjekkes FØRST,
			// og er den eneste av vaktene her som ikke hviler på en rad vi kontrollerer.
			// Et `metadata`-flagg dekker bare den ene raden, og det holdt ikke: synken
			// overskrev det, en sletting hos Withings propagerte aldri hit, og en rad
			// med revidert starttidspunkt får ny id og arver ingenting. Se
			// docs/changelog/2026-08-16-svarteliste-for-okter.md.
			if (
				suppressions.length > 0 &&
				isWorkoutSuppressed(
					{ startTime: new Date(w.startTime), sportFamily: clusterSportFamily(w.sportType) },
					suppressions
				)
			) {
				return false;
			}
			// Exclude clusters where any event has been dismissed — filter at cluster level so
			// partial dismissals (e.g. events[0] removed from DB query) don't let the cluster re-emerge
			if (w.evidence.some((e) => {
				const meta = normalizedEvents.find((ev) => ev.id === e.eventId)?.metadata;
				return meta?.dismissed === true || meta?.dismissed === 'true';
			})) return false;
			// Exclude unrecognized sport type — always Withings auto-detected noise with no classification
			if (w.sportType === 'unknown') return false;
			// Exclude sub-2-minute sessions with no track evidence — logging artifacts, not real workouts
			const hasTrackPoints = w.evidence.some((e) => e.hasTrackPoints);
			if (!hasTrackPoints && w.durationSeconds !== null && w.durationSeconds < 120) return false;
			return true;
		});

	console.log(`[activity-layer] buildUnifiedWorkoutActivities TOTAL: ${(performance.now() - t0).toFixed(0)}ms → ${unified.length} deduplicated workouts`);
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
/**
 * Sporet for en økt, hentet fra klynga når radens egen rad ikke har et.
 *
 * `/aktivitet/[id]` adresserer ÉN `sensor_events`-rad, og leste `trackPoints`
 * derfra. Men klyngingen slår Withings-raden og fil-raden av samme tur sammen,
 * og bare den ene av dem har GPS — så et kart fantes eller ikke ut fra hvilken
 * id lenka tilfeldigvis bar. Se `pickTrackSource` for hvorfor rekkefølgen er
 * som den er.
 *
 * **To spørringer, aldri én.** Den første henter bare METADATA om søsknene
 * (punktantall som et tall, ikke sporet), den andre henter sporet til vinneren.
 * Et `select` over flere `trackPoints`-kolonner ville lastet hvert spor i
 * klynga for å kaste alle unntatt ett — og et spor er opptil 2000 punkter.
 *
 * Returnerer null når raden selv har spor (kalleren bruker sitt eget), og når
 * ingen søsken har et brukbart.
 */
export async function readClusterTrackPoints(
	userId: string,
	eventId: string
): Promise<{ trackPoints: unknown[]; sourceEventId: string; provider: string } | null> {
	const anchor = await db
		.select({
			timestamp: sensorEvents.timestamp,
			sportType: sql<string | null>`${sensorEvents.data}->>'sportType'`,
			ownPoints: sql<number>`coalesce(case when jsonb_typeof(${sensorEvents.data}->'trackPoints') = 'array'
				then jsonb_array_length(${sensorEvents.data}->'trackPoints') else 0 end, 0)`
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId)))
		.limit(1);

	const row = anchor[0];
	if (!row) return null;
	// Radens eget spor vinner alltid. Vi fyller et hull, vi bytter ikke kilde.
	if (row.ownPoints >= MIN_USABLE_TRACK_POINTS) return null;

	const family = clusterSportFamily(row.sportType ?? 'workout');
	const from = new Date(row.timestamp.getTime() - CLUSTER_WINDOW_MS);
	const to = new Date(row.timestamp.getTime() + CLUSTER_WINDOW_MS);

	const siblings = await db
		.select({
			id: sensorEvents.id,
			sensorId: sensorEvents.sensorId,
			timestamp: sensorEvents.timestamp,
			sportType: sql<string | null>`${sensorEvents.data}->>'sportType'`,
			points: sql<number>`case when jsonb_typeof(${sensorEvents.data}->'trackPoints') = 'array'
				then jsonb_array_length(${sensorEvents.data}->'trackPoints') else 0 end`,
			// **NULL, ikke false, når nøkkelen mangler** — `->>` gir NULL og
			// `NULL in (…)` er NULL. Målt på Postgres 16. Kallstedet sammenligner
			// med `=== true`, så det er håndtert; typen skal likevel si det.
			// Formen godtar både JSON-boolsk `true` og strengen `"true"`, som er
			// nøyaktig de to `preferredEventFor` godtar — de to lagene skal ikke
			// være uenige om hvem som eier GPS.
			preferGps: sql<boolean | null>`${sensorEvents.metadata}->>'preferGps' in ('true', 't', '1')`,
			sourceRejected: sql<boolean | null>`${sensorEvents.metadata}->>'sourceRejected' in ('true', 't', '1')`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'workout'),
				gte(sensorEvents.timestamp, from),
				lte(sensorEvents.timestamp, to),
				ne(sensorEvents.id, eventId),
				// **`AND` gir ingen garantert evalueringsrekkefølge i Postgres**, så
				// en typesjekk ved siden av `jsonb_array_length` vokter ingenting:
				// planleggeren står fritt til å regne lengden av et objekt først og
				// kaste «cannot get array length of a scalar». `CASE` er den eneste
				// formen som faktisk beskytter. Et spor lagret i en annen form skal
				// gi ingen kandidat, ikke en 500 på øktsiden.
				sql`case when jsonb_typeof(${sensorEvents.data}->'trackPoints') = 'array'
					then jsonb_array_length(${sensorEvents.data}->'trackPoints') else 0 end >= ${MIN_USABLE_TRACK_POINTS}`
			)
		);

	const sameFamily = siblings.filter(
		(sibling) => clusterSportFamily(sibling.sportType ?? 'workout') === family
	);
	if (sameFamily.length === 0) return null;

	const sensorRows = await db.query.sensors.findMany({
		where: inArray(sensors.id, [...new Set(sameFamily.map((s) => s.sensorId))]),
		columns: { id: true, provider: true, type: true }
	});
	const sensorMap = new Map(sensorRows.map((sensor) => [sensor.id, sensor]));

	const winner = pickTrackSource(
		sameFamily.map((sibling) => {
			const sensor = sensorMap.get(sibling.sensorId);
			return {
				eventId: sibling.id,
				priority: sourcePriority(sensor?.provider ?? 'unknown', sensor?.type ?? 'unknown'),
				points: Number(sibling.points) || 0,
				startOffsetMs: sibling.timestamp.getTime() - row.timestamp.getTime(),
				preferGps: sibling.preferGps === true,
				sourceRejected: sibling.sourceRejected === true
			};
		})
	);
	if (!winner) return null;

	const trackRow = await db
		.select({ trackPoints: sql<unknown[]>`${sensorEvents.data}->'trackPoints'` })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.id, winner.eventId), eq(sensorEvents.userId, userId)))
		.limit(1);

	const trackPoints = trackRow[0]?.trackPoints;
	if (!Array.isArray(trackPoints) || trackPoints.length < MIN_USABLE_TRACK_POINTS) return null;

	const sensor = sensorMap.get(sameFamily.find((s) => s.id === winner.eventId)!.sensorId);
	return {
		trackPoints,
		sourceEventId: winner.eventId,
		provider: sensor?.provider ?? 'unknown'
	};
}
