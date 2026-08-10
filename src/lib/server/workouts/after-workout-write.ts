/**
 * Én vei inn for «en treningsøkt er skrevet».
 *
 * Se `docs/changelog/2026-08-10-en-vei-inn-for-nye-okter.md`.
 *
 * Fram til august 2026 lå etterbehandlingen inni Withings-synken og
 * Dropbox-importen, én kopi hver. `/api/apps/upload` — Ekkos vei inn, den
 * raskeste av de tre — skrev `sensor_events`-raden og gjorde ellers ingenting.
 * Resultatet var at den turen du nettopp hadde løpt ikke ga push, ikke haket av
 * ukas løpeøkt, og ikke fantes i dagsaggregatet før nattjobben; alt sammen kom
 * i stedet timer senere, når en ANNEN kilde beskrev den samme turen.
 *
 * Regelen er derfor: skriver du en workout-hendelse, kaller du denne. Da kan
 * ingen inngang bli hengende etter uten at noen ser hvorfor.
 *
 * Hvert steg er innkapslet i sin egen try/catch. En feilet nudge skal aldri
 * velte opplastingen — Ekko har allerede kastet GPX-en når svaret kommer, og en
 * 500 her ville kostet en økt for å spare et varsel.
 */

import { db } from '$lib/db';
import { workoutNotifications } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { autocheckChecklistItemsForDay, autocheckWeekChecklistItems } from '$lib/server/checklist-autocheck';
import { syncSensorProgressForTasks } from '$lib/server/sensor-progress-sync';
import { getWorkoutContextForUser, type WorkoutContextSummary } from '$lib/server/workout-context';
import { notifyUserAboutImportedWorkouts } from '$lib/server/workout-notifications';
import {
	aggregationStartDate,
	FOLLOWUP_MAX_AGE_DAYS,
	selectClustersToNotify,
	selectFollowupDays,
	type WorkoutClusterRef
} from '$lib/domain/health/workout-followup';

/**
 * Klyngevinduet i aktivitetslaget. Vi henter kilder fra to timer før den eldste
 * nye hendelsen, ellers splittes den fra sine egne duplikater i kanten.
 */
const CLUSTER_LOOKBACK_MS = 2 * 60 * 60 * 1000;

export type AfterWorkoutWriteInput = {
	userId: string;
	/** `sensor_events.id` for workout-radene som nettopp ble skrevet. */
	eventIds: string[];
	/** Øktenes egne tidsstempler — styrer hvilken dag/uke som regnes om. */
	timestamps: Date[];
	/** Absolutt URL til appen. Uten den kan vi ikke bygge en lenke, og varselet hoppes over. */
	appUrl: string | null;
	/** Hvilken inngang som skrev — havner i loggen og i `workout_notifications.source`. */
	source: string;
	/**
	 * Skal denne skrivingen kunne gi push?
	 *
	 * `false` for Withings-synken, som beholder sin egen, bevisst smale
	 * varsling (`notifyWithingsSyncResults` — yoga og vekt). Klokka registrerer
	 * gåturer og småøkter av seg selv, og et varsel per stykk ville blitt støy.
	 * De øvrige stegene kjøres uansett.
	 */
	notify?: boolean;
	/** Settes av backfill/rescan: hopper over varsling uansett. */
	backfill?: boolean;
};

export type AfterWorkoutWriteResult = {
	aggregated: boolean;
	autochecked: boolean;
	progressSynced: boolean;
	notified: number;
	skippedAlreadyNotified: number;
	errors: string[];
};

/** Mandag–mandag rundt et tidspunkt, samme vindu som withings-synken brukte. */
function weekWindow(timestamp: Date): { weekStart: Date; weekEnd: Date } {
	const dayOfWeek = timestamp.getUTCDay() || 7; // Mon=1 … Sun=7
	const weekStart = new Date(timestamp);
	weekStart.setUTCDate(timestamp.getUTCDate() - dayOfWeek + 1);
	weekStart.setUTCHours(0, 0, 0, 0);
	const weekEnd = new Date(weekStart);
	weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
	return { weekStart, weekEnd };
}

export async function runAfterWorkoutWrite(
	input: AfterWorkoutWriteInput
): Promise<AfterWorkoutWriteResult> {
	const result: AfterWorkoutWriteResult = {
		aggregated: false,
		autochecked: false,
		progressSynced: false,
		notified: 0,
		skippedAlreadyNotified: 0,
		errors: []
	};

	if (input.eventIds.length === 0) return result;

	const now = new Date();
	const timestamps = input.timestamps.filter((t) => Number.isFinite(t.getTime()));
	const t0 = performance.now();

	const record = (step: string, err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		result.errors.push(`${step}: ${message}`);
		console.error(`[after-workout-write] ${step} feilet user=${input.userId} source=${input.source}: ${message}`);
	};

	// 1. Aggregater. Uten dette står dagsraden (`aggregateDailyEffort`) tom til
	//    nattjobben — og det er den form- og belastningskortene leser.
	//
	//    Uten tidsstempler ville `aggregationStartDate` falt tilbake på taket og
	//    dratt 90 dager med aggregering inn i en skriving som ikke ba om det.
	if (timestamps.length === 0) {
		result.errors.push('aggregate: ingen gyldige tidsstempler, hoppet over');
	} else {
		try {
			await aggregatePeriodsFrom(input.userId, aggregationStartDate(timestamps, now));
			result.aggregated = true;
		} catch (err) {
			record('aggregate', err);
		}
	}

	// Autohaking og progresjon gjelder bare ferske økter — se FOLLOWUP_MAX_AGE_DAYS.
	const followup = selectFollowupDays(timestamps, now);
	if (followup.skipped > 0) {
		console.log(
			`[after-workout-write] hoppet over autohaking/progresjon for ${followup.skipped} økt(er) eldre enn vinduet (source=${input.source})`
		);
	}
	const freshTimestamps = timestamps.filter(
		(t) => now.getTime() - t.getTime() <= FOLLOWUP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
	);

	// 2. Autohaking. Dag og uke, på øktas EGEN Oslo-dato — ikke på «i dag», som
	//    ville bommet på en økt lastet opp dagen etter.
	try {
		for (const date of followup.dates) {
			await autocheckChecklistItemsForDay({ userId: input.userId, date });
			await autocheckWeekChecklistItems({ userId: input.userId, date });
		}
		result.autochecked = followup.dates.length > 0;
	} catch (err) {
		record('autocheck', err);
	}

	// 3. Målprogresjon på oppgaver.
	try {
		const weeks = new Map<string, { weekStart: Date; weekEnd: Date }>();
		for (const timestamp of freshTimestamps) {
			const window = weekWindow(timestamp);
			weeks.set(window.weekStart.toISOString(), window);
		}
		for (const window of weeks.values()) {
			await syncSensorProgressForTasks({ userId: input.userId, ...window });
		}
		result.progressSynced = weeks.size > 0;
	} catch (err) {
		record('progress-sync', err);
	}

	// 4. Varsel — dedupert på tvers av kilder.
	const shouldNotify = input.notify !== false && input.backfill !== true;
	if (shouldNotify && !input.appUrl) {
		result.errors.push('notify: mangler appUrl, varsel hoppet over');
	} else if (shouldNotify && input.appUrl) {
		try {
			const notifyResult = await notifyForWrittenWorkouts({
				userId: input.userId,
				appUrl: input.appUrl,
				eventIds: input.eventIds,
				timestamps,
				source: input.source,
				now
			});
			result.notified = notifyResult.notified;
			result.skippedAlreadyNotified = notifyResult.skippedAlreadyNotified;
		} catch (err) {
			record('notify', err);
		}
	}

	console.log(
		`[after-workout-write] source=${input.source} user=${input.userId} events=${input.eventIds.length} ` +
			`aggregated=${result.aggregated ? 1 : 0} autocheck=${result.autochecked ? 1 : 0} ` +
			`progress=${result.progressSynced ? 1 : 0} notified=${result.notified} ` +
			`dedup=${result.skippedAlreadyNotified} errors=${result.errors.length} ` +
			`durationMs=${(performance.now() - t0).toFixed(0)}`
	);

	return result;
}

/**
 * Sender ett varsel per REELL økt, ikke per kilde.
 *
 * Kildene slås sammen med `buildUnifiedWorkoutActivities` — samme klynging som
 * alt annet som teller økter — og hele klynga slås opp mot `workout_notifications`.
 * Er én av kildene varslet om før, er turen allerede meldt, uansett hvilken
 * kilde som lander nå.
 */
async function notifyForWrittenWorkouts(input: {
	userId: string;
	appUrl: string;
	eventIds: string[];
	timestamps: Date[];
	source: string;
	now: Date;
}): Promise<{ notified: number; skippedAlreadyNotified: number }> {
	const earliest = input.timestamps.length
		? input.timestamps.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
		: input.now;
	const since = new Date(earliest.getTime() - CLUSTER_LOOKBACK_MS);

	const unified = await buildUnifiedWorkoutActivities(input.userId, { since });
	const clusters: WorkoutClusterRef[] = unified.map((activity) => ({
		activityId: activity.activityId,
		startTime: activity.startTime,
		evidence: activity.evidence.map((e) => ({
			eventId: e.eventId,
			timestamp: e.timestamp,
			hasTrackPoints: e.hasTrackPoints
		}))
	}));

	// Alle hendelses-ider i de berørte klyngene slås opp på én gang: en kilde
	// som ble varslet om for tre dager siden skal fortsatt blokkere.
	const candidateEventIds = [
		...new Set(clusters.flatMap((c) => c.evidence.map((e) => e.eventId)))
	];
	const notifiedRows = candidateEventIds.length
		? await db
				.select({ sensorEventId: workoutNotifications.sensorEventId })
				.from(workoutNotifications)
				.where(
					and(
						eq(workoutNotifications.userId, input.userId),
						inArray(workoutNotifications.sensorEventId, candidateEventIds)
					)
				)
		: [];

	const selected = selectClustersToNotify({
		clusters,
		writtenEventIds: input.eventIds,
		alreadyNotifiedEventIds: notifiedRows.map((r) => r.sensorEventId),
		now: input.now
	});

	const touchedClusters = clusters.filter((c) =>
		c.evidence.some((e) => input.eventIds.includes(e.eventId))
	).length;

	if (selected.length === 0) {
		return { notified: 0, skippedAlreadyNotified: touchedClusters };
	}

	const summaries = (
		await Promise.all(
			selected.map(async (item) => {
				const workout = await getWorkoutContextForUser(input.userId, item.linkEventId);
				return workout ? { item, workout } : null;
			})
		)
	).filter((row): row is { item: (typeof selected)[number]; workout: WorkoutContextSummary } => row !== null);

	if (summaries.length === 0) {
		return { notified: 0, skippedAlreadyNotified: touchedClusters };
	}

	// Bokfør FØR utsending. To samtidige skrivinger av samme tur (Ekko lastet
	// opp i samme minutt som Dropbox-cronen importerte den) ville ellers begge
	// se «ingen varsel sendt» og sende hver sin. Unik-indeksen avgjør hvem som
	// vant; taperen får 0 rader tilbake og sender ingenting.
	//
	// Prisen er at et varsel som feiler under utsending ikke prøves på nytt.
	// Det er riktig vei å bomme: en tapt push er en økt du ser neste gang du
	// åpner appen, mens dobbeltvarsling er den støyen som får folk til å skru
	// av varsler for godt.
	const claimed = await db
		.insert(workoutNotifications)
		.values(
			summaries.flatMap(({ item }) =>
				item.cluster.evidence.map((e) => ({
					userId: input.userId,
					sensorEventId: e.eventId,
					activityId: item.cluster.activityId,
					source: input.source
				}))
			)
		)
		.onConflictDoNothing()
		.returning({ activityId: workoutNotifications.activityId });

	const claimedActivityIds = new Set(claimed.map((row) => row.activityId));
	const toSend = summaries.filter(({ item }) => claimedActivityIds.has(item.cluster.activityId));

	if (toSend.length === 0) {
		return { notified: 0, skippedAlreadyNotified: touchedClusters };
	}

	const delivery = await notifyUserAboutImportedWorkouts({
		userId: input.userId,
		appUrl: input.appUrl,
		workouts: toSend.map(({ workout }) => workout)
	});

	return {
		notified: delivery.sent,
		skippedAlreadyNotified: touchedClusters - toSend.length
	};
}
