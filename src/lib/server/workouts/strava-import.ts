/**
 * Import av en Strava-eksport: manifestet styrer, fila bærer sporet.
 *
 * Se `docs/changelog/2026-09-04-strava-arkivimport.md`. Reglene for manifestet
 * bor i `$lib/domain/health/strava-export.ts`, triagen i
 * `$lib/domain/health/import-triage.ts`, FIT-dekodingen i `fit-parse.ts`.
 *
 * **Triagen er en PORT, ikke en rapport.** En sykkeltur merket «Run» skal ikke
 * skrives og siden ryddes opp: en distanserekord er «min over alle økter», så
 * i mellomtiden HAR den vært rekorden, og VDOT-estimatet er dratt med. Derfor
 * dømmes raden på manifestets tall før fila pakkes ut.
 *
 * **Vi sletter aldri, og vi overskriver aldri.** Jobben er idempotent: en rad
 * som alt finnes hoppes over på kildestien, så en avbrutt import kan kjøres om
 * igjen. Samme regel som Withings-berikelsen.
 */

import { and, eq, sql } from 'drizzle-orm';
import { gunzipSync } from 'node:zlib';
import { db, rowsOf } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { toPgArrayLiteral } from '$lib/db/pg-array';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { runAfterWorkoutWrite } from '$lib/server/workouts/after-workout-write';
import {
	downsampleTrack,
	parseWorkoutFile,
	MAX_STORED_TRACK_POINTS,
	type ParsedWorkout
} from '$lib/server/integrations/dropbox-sync';
import { parseFit, describeFitContents, FitParseError } from '$lib/server/workouts/fit-parse';
import {
	skipReasonFor,
	stripGzip,
	triageCandidateFromRow,
	type SkipReason,
	type StravaManifestRow
} from '$lib/domain/health/strava-export';
import {
	triageCandidate,
	type PaceReference,
	type TriageFinding
} from '$lib/domain/health/import-triage';

/** Kilden alle importerte rader bærer, og nøkkelen dedupen slår opp på. */
export const STRAVA_IMPORT_SOURCE = 'strava_export';

/**
 * Aksene som HOLDER en økt ute av importen.
 *
 * Bare `for-rask`, og det er en beslutning. De tre andre er verdt å vite om,
 * men skaden de gjør er reversibel: en for kort økt kan skjules, en for lang
 * kan rettes ved å kutte sporet, en for langsom drar en trend litt. En
 * for-rask økt blir en distanserekord, og en rekord er «min over alt» — den
 * blir stående til noen finner den. Derfor er den ene aksen en port og de tre
 * andre en rapport.
 */
export const BLOCKING_AXES = new Set<TriageFinding['axis']>(['for-rask']);

/**
 * Hvor langt utenfor kurven en økt må ligge for å bli HOLDT UTE.
 *
 * **Rapporteringsterskelen og portterskelen er ulike, og det er en måling som
 * gjorde dem ulike.** `PACE_SUSPECT_RATIO` (1,0) er «verdt et blikk»: på eller
 * raskere enn brukerens egen kurve. Som port er den for streng — målt på
 * arkivet 4. september 2026 blokkerte den tre økter, og to av dem lå fire og
 * elleve SEKUNDER under kurven over 7–8 km. Det er en ekte hard økt, ikke en
 * feilmerket sykkeltur, og å avvise den er å slette noe brukeren gjorde.
 *
 * 1,1 lar de to stå og stopper den ene som ligger 18 % under kurven — nøyaktig
 * den brukeren selv kalte suspekt («4k på 4:00/k også veldig suspekt»).
 *
 * Tallet er derfor kalibrert mot brukerens egen dom på sitt eget arkiv, ikke
 * mot en antakelse om hva som er raskt.
 */
export const BLOCK_PACE_RATIO = 1.1;

export type ImportFile = {
	/** Stravas aktivitets-id, som parer fila mot manifestraden. */
	id: string;
	bytes: Uint8Array;
};

export type ImportOutcome =
	| { status: 'written'; id: string; eventId: string; timestamp: Date }
	| { status: 'existed'; id: string }
	| {
			status: 'skipped';
			id: string;
			reason: SkipReason | 'ingen-fil-i-batch' | 'ingen-spor';
			/** Hva fila inneholdt, når grunnen er `ingen-spor`. */
			detail?: string;
	  }
	| { status: 'blocked'; id: string; findings: TriageFinding[] }
	| { status: 'failed'; id: string; error: string };

export type ImportResult = {
	/** Rader skrevet til basen nå. */
	written: number;
	/** Rader som alt fantes — jobben er idempotent. */
	existed: number;
	/** Rader uten fil, ukjent sport eller uten brukbart spor. */
	skipped: number;
	/** Rader triagen holdt ute. Summerer IKKE med de andre. */
	blocked: number;
	failed: number;
	notified: number;
	outcomes: ImportOutcome[];
};

/**
 * Hvilke av disse id-ene er alt importert — uten å sende en eneste fil.
 *
 * Skrivingen er idempotent i seg selv (`findAlreadyImported` fanger dem, og
 * `conflictMode: 'ignore'` gjør resten), så en ny kjøring har ALLTID vært
 * trygg. Men den var ikke billig: klienten sendte alle 1019 filene på nytt,
 * serveren pakket ut og parset dem, og kastet resultatet for de som alt lå
 * inne. Etter et avbrudd — en skjerm som slår seg av midt i en runde — var
 * prisen for å fortsette den samme som for å begynne forfra.
 *
 * **Serveren er fasit, ikke klientens framdrift.** Alternativet var å lagre
 * hvor langt man kom i `localStorage`, men den kan gå ut av takt med basen på
 * en måte ingen ser: en rad skrevet i en runde der svaret aldri nådde fram
 * ville stått som «ikke gjort» for alltid. Et oppslag mot radene som FINNES
 * kan ikke lyve.
 *
 * Returnerer et tomt sett når sensoren ikke finnes ennå — da er ingenting
 * importert, og en tom sensor skal ikke opprettes av et spørsmål.
 */
export async function findImportedIds(userId: string, ids: string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const sensor = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'strava_export'),
			eq(sensors.type, 'workout_files')
		),
		columns: { id: true }
	});
	if (!sensor) return new Set();
	return findAlreadyImported(sensor.id, ids);
}

async function getOrCreateStravaExportSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'strava_export'),
			eq(sensors.type, 'workout_files')
		)
	});
	if (existing) return existing;

	// **Egen sensor, ikke Stravas OAuth-sensor.** Den siste har credentials og
	// synkes; denne er en engangsimport av et arkiv. Blandet man dem, ville en
	// `fullSync` mot OAuth-sensoren slettet arkivet — og arkivet kan ikke
	// hentes inn igjen uten at brukeren ber Strava om en ny eksport.
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'strava_export',
			type: 'workout_files',
			subtype: 'archive_import',
			name: 'Strava-arkiv',
			isActive: true,
			config: {}
		})
		.returning();
	return created;
}

/**
 * Hvilke aktivitets-id-er som alt er importert.
 *
 * Slår opp på `metadata.stravaActivityId`, ikke på tidsstempel: to økter samme
 * minutt fra ulike kilder er dedupens jobb (klyngingen på to timer), mens
 * spørsmålet HER er «har vi lest denne FILA før». Ett oppslag for hele batchen
 * framfor ett per rad.
 */
export async function findAlreadyImported(sensorId: string, ids: string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	// **En JS-Array er aldri en gyldig parameter til rå SQL.** `inferType` gir
	// en Array skalar-OID-en til FØRSTE element, så en liste med strenger blir
	// «a,b» og Postgres svarer «malformed array literal». `toPgArrayLiteral`
	// bygger literalen, og den sendes som ÉN tekstparameter til `::text[]`.
	// Se docs/changelog/2026-09-03-array-parametere-til-postgres.md.
	const rows = await rowsOf<{ strava_id: string }>(
		db.execute(sql`
			SELECT metadata->>'stravaActivityId' AS strava_id
			FROM sensor_events
			WHERE sensor_id = ${sensorId}
			  AND data_type = 'workout'
			  AND metadata->>'stravaActivityId' = ANY(${toPgArrayLiteral(ids)}::text[])
		`)
	);
	return new Set(rows.map((r) => r.strava_id).filter((v): v is string => typeof v === 'string'));
}

export type DecodedFile = {
	workout: ParsedWorkout | null;
	/**
	 * Hvorfor det ikke ble noe, når `workout` er null.
	 *
	 * «ingen brukbart spor» alene kollapset tre ulike tilstander til ett ord, og
	 * rapporten kunne derfor ikke si om det var dataene eller parseren. Nå sier
	 * den hva fila FAKTISK inneholdt.
	 */
	detail: string | null;
};

/** Pakker ut `.gz` og velger parser på endelsen under. */
export function decodeWorkoutFile(filePath: string, bytes: Uint8Array): DecodedFile {
	const { path, gzipped } = stripGzip(filePath);
	const raw = gzipped ? new Uint8Array(gunzipSync(bytes)) : bytes;

	if (path.toLowerCase().endsWith('.fit')) {
		const { workout, contents } = parseFit(raw);
		return { workout, detail: workout ? null : describeFitContents(contents) };
	}

	// GPX og TCX er tekst. `parseWorkoutFile` velger mellom dem på endelsen.
	const workout = parseWorkoutFile(path, new TextDecoder().decode(raw));
	if (workout) return { workout, detail: null };

	// GPX/TCX-parserne rapporterer ikke hvorfor, så vi teller punktene selv —
	// et tall skiller «tom fil» fra «fil med punkter vi ikke leste».
	const text = new TextDecoder().decode(raw);
	const points = (text.match(/<trkpt|<Trackpoint/gi) ?? []).length;
	return {
		workout: null,
		detail: points === 0 ? 'ingen punkter i fila' : `${points} punkter i fila, men ingen med posisjon`
	};
}

/**
 * Importerer én batch.
 *
 * Batchen kommer fra klienten, som pakker ut zipen i nettleseren — se
 * `StravaImportCard`. Serveren ser aldri hele arkivet på én gang, og det er
 * med vilje: 1020 spor i minnet samtidig ville ligget på hundrevis av MB.
 */
export async function importStravaBatch(options: {
	userId: string;
	rows: StravaManifestRow[];
	files: ImportFile[];
	paceReference?: PaceReference;
	appUrl?: string | null;
	dryRun?: boolean;
}): Promise<ImportResult> {
	const { userId, rows, files, paceReference, dryRun = false } = options;
	const bytesById = new Map(files.map((f) => [f.id, f.bytes]));
	const outcomes: ImportOutcome[] = [];

	const sensor = dryRun ? null : await getOrCreateStravaExportSensor(userId);
	const alreadyImported = sensor
		? await findAlreadyImported(sensor.id, rows.map((r) => r.id))
		: new Set<string>();

	const writtenIds: string[] = [];
	const writtenTimestamps: Date[] = [];

	for (const row of rows) {
		if (alreadyImported.has(row.id)) {
			outcomes.push({ status: 'existed', id: row.id });
			continue;
		}

		const skip = skipReasonFor(row);
		if (skip) {
			outcomes.push({ status: 'skipped', id: row.id, reason: skip });
			continue;
		}

		// Triagen dømmer MANIFESTETS tall — før fila pakkes ut, og før noe skrives.
		const findings = triageCandidate(triageCandidateFromRow(row), { paceReference });
		const blocking = findings.filter(
			(f) => BLOCKING_AXES.has(f.axis) && f.ratio >= BLOCK_PACE_RATIO
		);
		if (blocking.length > 0) {
			outcomes.push({ status: 'blocked', id: row.id, findings });
			continue;
		}

		const bytes = bytesById.get(row.id);
		if (!bytes) {
			outcomes.push({ status: 'skipped', id: row.id, reason: 'ingen-fil-i-batch' });
			continue;
		}

		try {
			const { workout: parsed, detail } = decodeWorkoutFile(row.filePath!, bytes);
			if (!parsed) {
				outcomes.push({
					status: 'skipped',
					id: row.id,
					reason: 'ingen-spor',
					detail: detail ?? undefined
				});
				continue;
			}

			// **Manifestet vinner på metadata.** `parseGpx` hardkoder
			// `sportType: 'running'`, og distansen dens er summert haversine med
			// GPS-støyen i. Fila eier punktene; Strava eier tallene.
			const sportType = row.sportType!;
			const distance = row.distanceMeters ?? parsed.distance;
			const duration = row.elapsedSeconds ?? parsed.duration;
			const paceSecondsPerKm = distance > 0 ? duration / (distance / 1000) : undefined;

			if (dryRun) {
				outcomes.push({ status: 'written', id: row.id, eventId: '(dry-run)', timestamp: parsed.startTime });
				continue;
			}

			const sampledTrack = downsampleTrack(parsed.trackPoints, MAX_STORED_TRACK_POINTS).map((p) => ({
				lat: p.lat,
				lon: p.lon,
				ele: p.ele,
				hr: p.hr,
				time: p.time
			}));

			// **`ignore`, ikke `error`.** To ulike aktiviteter kan kollidere på
			// (sensor, datatype, tidspunkt) — samme tur eksportert to ganger, eller
			// en manuell rad som deler startsekund. Med `error` ble det en
			// «failed» som ser ut som en ødelagt fil; med `ignore` er det det det
			// er: raden fantes fra før. Jobben skal kunne kjøres om igjen.
			const { event, inserted } = await SensorEventService.write({
				userId,
				sensorId: sensor!.id,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: parsed.startTime,
				data: {
					sportType,
					duration,
					distance,
					elevation: parsed.elevation,
					avgHeartRate: parsed.avgHeartRate,
					maxHeartRate: parsed.maxHeartRate,
					minHeartRate: parsed.minHeartRate,
					paceSecondsPerKm,
					trackPoints: sampledTrack
				},
				metadata: {
					stravaActivityId: row.id,
					sourceName: row.filePath,
					sourceFormat: parsed.sourceFormat,
					sourceTitle: row.name,
					totalTrackPoints: parsed.trackPoints.length,
					// Bevegelsestida lagres, men effort skåres på `duration`
					// (elapsed) som ellers. Feltet er her for at
					// `suggestForgottenTracking` skal kunne se gapet senere.
					movingSeconds: row.movingSeconds,
					// Funn triagen ikke blokkerte på. En rad som ble skrevet med
					// et for-lang-funn skal kunne finnes igjen.
					triageFindings: findings.length > 0 ? findings.map((f) => f.axis) : undefined
				},
				source: STRAVA_IMPORT_SOURCE
			}, { conflictMode: 'ignore' });

			if (!event || !inserted) {
				outcomes.push({ status: 'existed', id: row.id });
				continue;
			}

			outcomes.push({ status: 'written', id: row.id, eventId: event.id, timestamp: parsed.startTime });
			writtenIds.push(event.id);
			writtenTimestamps.push(parsed.startTime);
		} catch (error) {
			const message =
				error instanceof FitParseError
					? error.message
					: error instanceof Error
						? error.message
						: 'Ukjent feil';
			outcomes.push({ status: 'failed', id: row.id, error: message });
		}
	}

	// **`backfill: true` alltid.** Et arkiv fra 2012 skal ikke få telefonen til
	// å vibrere 1019 ganger, og autohakingen skal ikke løpe én gang per
	// kalenderdag siden 2012. `selectFollowupDays` kapper vinduet og rapporterer
	// hva den hoppet over.
	let notified = 0;
	if (writtenIds.length > 0 && !dryRun) {
		const followup = await runAfterWorkoutWrite({
			userId,
			eventIds: writtenIds,
			timestamps: writtenTimestamps,
			appUrl: options.appUrl ?? null,
			source: STRAVA_IMPORT_SOURCE,
			backfill: true
		});
		notified = followup.notified;
	}

	const count = (status: ImportOutcome['status']) => outcomes.filter((o) => o.status === status).length;

	return {
		written: count('written'),
		existed: count('existed'),
		skipped: count('skipped'),
		blocked: count('blocked'),
		failed: count('failed'),
		notified,
		outcomes
	};
}
