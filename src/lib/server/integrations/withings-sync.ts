import { db } from '$lib/db';
import {
	fullSyncFloorSeconds,
	resolveFullSyncFloor,
	WITHINGS_FULL_SYNC_DEFAULT_FLOOR
} from '$lib/domain/health/withings-sync-window';
import { sensors, sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq, and, isNull, gte, lt } from 'drizzle-orm';
import { refreshAccessToken, fetchAllWithingsData, fetchWithingsSleep } from './withings';
import { isPlausibleVo2max, VO2MAX_MAX, VO2MAX_MIN } from '$lib/domain/health/vo2max';
import {
	WITHINGS_TEMPERATURE_MEASTYPES,
	isPlausibleTemperature,
	kindForMeastype
} from '$lib/domain/health/temperature';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { runAfterWorkoutWrite } from '$lib/server/workouts/after-workout-write';
import { computeSleepLag } from '$lib/server/services/sleep-lag';
import { syncHrRecovery } from './withings-hr-recovery';
import { syncSleepHrv } from './withings-sleep-hrv';
import { recordSensorSyncFailure } from '$lib/server/sensors/sync-status';

/**
 * Get active Withings sensor for user
 */
export async function getWithingsSensor(userId: string) {
	return await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, 'withings'),
			eq(sensors.isActive, true)
		)
	});
}

/**
 * Get valid access token (refresh if expired)
 */
export async function getValidAccessToken(sensor: any): Promise<string> {
	const credentials = JSON.parse(atob(sensor.credentials));
	const now = Math.floor(Date.now() / 1000);

	console.log('   Token expires at:', credentials.expires_at ? new Date(credentials.expires_at * 1000).toISOString() : 'unknown');
	console.log('   Current time:', new Date(now * 1000).toISOString());
	console.log('   Token expired?', credentials.expires_at && now >= credentials.expires_at - 300);

	// Check if token is expired
	if (credentials.expires_at && now >= credentials.expires_at - 300) {
		// Refresh token (5 min buffer)
		console.log('   Token expired, refreshing...');
		const refreshed = await refreshAccessToken(credentials.refresh_token);

		console.log('   Refresh response:', refreshed);

		if (refreshed.status !== 0) {
			console.error('   Failed to refresh token:', refreshed);
			throw new Error(`Failed to refresh Withings token: ${JSON.stringify(refreshed)}`);
		}

		const { access_token, refresh_token, expires_in } = refreshed.body;
		const newExpiresAt = now + expires_in;

		// Update stored credentials
		const newCredentials = btoa(
			JSON.stringify({
				access_token,
				refresh_token,
				expires_at: newExpiresAt
			})
		);

		await db
			.update(sensors)
			.set({
				credentials: newCredentials,
				config: {
					...(sensor.config as any),
					expiresAt: newExpiresAt
				},
				updatedAt: new Date()
			})
			.where(eq(sensors.id, sensor.id));

		return access_token;
	}

	return credentials.access_token;
}

/**
 * Parse Withings weight measurements
 */
/**
 * Withings' måletyper i en vektgruppe.
 *
 * NB på 6 vs 8: **6 er fettPROSENT, 8 er fettmasse i KG.** Parseren leste
 * historisk type 6 og lagret den som `fatMass`, og `readBodyComposition`
 * returnerte den som `fatMassKg` — så et fettmasse-mål i /plan/mal viste 22 der
 * svaret var 18. Tallet ser plausibelt ut, og derfor sto feilen i ro.
 *
 * `fatRatio` og `fatMassKg` er nå skilt. Legacy-feltet `fatMass` skrives ikke
 * lenger; `normalizeBodyComposition` tolker gamle rader riktig ved å regne kilo
 * fra prosenten og vekta på samme rad.
 */
const MEASTYPE = {
	weight: 1,
	fatFreeMass: 5,
	fatRatio: 6,
	fatMassKg: 8,
	pulse: 11,
	muscleMass: 76,
	hydration: 77,
	boneMass: 88
} as const;

/**
 * Måletypene vi ber om i vekt-kallet.
 *
 * En smartvekt poster alt i én gruppe, så disse kommer sannsynligvis inn uansett
 * — men å be om dem eksplisitt gjør det uavhengig av om Withings filtrerer
 * innenfor gruppene. `meastypes` (flertall) er kommaseparert.
 */
/**
 * Hele kroppssettet i ett kall. Eksportert fordi diagnoseendepunktet må spørre om
 * NØYAKTIG det synken spør om — ellers svarer det på et annet spørsmål enn det stilte.
 */
export const WITHINGS_BODY_MEASTYPES = [
	MEASTYPE.weight,
	MEASTYPE.fatFreeMass,
	MEASTYPE.fatRatio,
	MEASTYPE.fatMassKg,
	MEASTYPE.pulse,
	MEASTYPE.muscleMass,
	MEASTYPE.hydration,
	MEASTYPE.boneMass
].join(',');

function measureValue(grp: any, type: number): number | undefined {
	const measure = grp.measures?.find((m: any) => m.type === type);
	return measure ? measure.value * Math.pow(10, measure.unit) : undefined;
}

/**
 * Eksportert fordi berikelsesjobben (`withings-weight-enrichment.ts`) må tolke
 * nøyaktig som synken gjør. En andre måletype-tabell ville drevet fra denne — det
 * er akkurat feilen batch-prefetchen gjorde da den ba om `meastype: 1` alene.
 */
export function parseWeightData(measuregrps: any[]): any[] {
	return measuregrps
		.filter((grp) => grp.measures?.some((m: any) => m.type === MEASTYPE.weight))
		.map((grp) => ({
			timestamp: new Date(grp.date * 1000),
			data: {
				weight: measureValue(grp, MEASTYPE.weight),
				fatRatio: measureValue(grp, MEASTYPE.fatRatio),
				fatMassKg: measureValue(grp, MEASTYPE.fatMassKg),
				fatFreeMass: measureValue(grp, MEASTYPE.fatFreeMass),
				muscleMass: measureValue(grp, MEASTYPE.muscleMass),
				boneMass: measureValue(grp, MEASTYPE.boneMass),
				hydration: measureValue(grp, MEASTYPE.hydration),
				// Punktpuls fra vekta: den beste hvilepulsen vi kan få, langt bedre
				// enn snittpuls fra søvn som getEffortBaseline bruker i dag.
				restingHeartRate: measureValue(grp, MEASTYPE.pulse)
			},
			metadata: { grpid: grp.grpid, deviceid: grp.deviceid }
		}));
}

/**
 * Dagsfelter fra getactivity.
 *
 * `totalcalories` er den viktige: `calories` er BARE aktivitetskalorier, mens
 * totalcalories er hvileforbrenning + aktivitet — altså den andre siden av
 * energibalansen ernæringsloggeren måler. Uten den har Ernæring bare inntaket.
 */
const WITHINGS_ACTIVITY_DATA_FIELDS = [
	'steps',
	'distance',
	'elevation',
	'soft',
	'moderate',
	'intense',
	'active',
	'calories',
	'totalcalories',
	'hr_average',
	'hr_min',
	'hr_max'
].join(',');

/**
 * Parse Withings activity data
 * Activity.date is in format "YYYY-MM-DD" representing the user's local day
 */
function parseActivityData(activities: any[]): any[] {
	return activities.map((activity) => ({
		// Parse as UTC midnight to avoid timezone shifts
		// "2026-04-12" → 2026-04-12T00:00:00.000Z
		timestamp: new Date(activity.date + 'T00:00:00.000Z'),
		data: {
			steps: activity.steps,
			distance: activity.distance,
			calories: activity.calories,
			// Hvileforbrenning + aktivitet. `calories` over er bare aktiviteten.
			totalCalories: activity.totalcalories,
			elevation: activity.elevation,
			soft: activity.soft, // Light activity (in seconds, per Withings API)
			moderate: activity.moderate, // Moderate activity (in seconds, per Withings API)
			intense: activity.intense, // Intense activity (in seconds, per Withings API)
			hr_average: activity.hr_average,
			hr_min: activity.hr_min,
			hr_max: activity.hr_max
		},
		metadata: { modified: activity.modified, date_string: activity.date }
	}));
}

/**
 * Parse Withings sleep data
 */
function parseSleepData(series: any[]): any[] {
	return series.map((sleep) => {
		const sleepStart = new Date(sleep.startdate * 1000);
		const sleepEnd = typeof sleep.enddate === 'number' ? new Date(sleep.enddate * 1000) : undefined;
		const sleepLag = sleepEnd ? computeSleepLag(sleepStart, sleepEnd) : undefined;

		return {
			timestamp: sleepStart,
			data: {
				sleepDuration: sleep.data?.total_sleep_time,
				sleepDeep: sleep.data?.deepsleepduration,
				sleepLight: sleep.data?.lightsleepduration,
				sleepRem: sleep.data?.remsleepduration,
				wakeupDuration: sleep.data?.wakeupduration,
				sleepScore: sleep.data?.sleep_score,
				hr_average: sleep.data?.hr_average,
				hr_min: sleep.data?.hr_min,
				hr_max: sleep.data?.hr_max,
				rr_average: sleep.data?.rr_average,
				// Innsovningstid og våkentid — de to Withings måler som svarer på
				// det samme som den manuelle søvnloggeren. Sekunder.
				sleepLatency: sleep.data?.sleep_latency,
				wakeupLatency: sleep.data?.wakeup_latency,
				waso: sleep.data?.waso,
				outOfBedCount: sleep.data?.out_of_bed_count,
				sleepEfficiency: sleep.data?.sleep_efficiency,
				// Pust og snorking. `snoring` er sekunder, ikke en score.
				apneaHypopneaIndex: sleep.data?.apnea_hypopnea_index,
				breathingDisturbances: sleep.data?.breathing_disturbances_intensity,
				snoringSeconds: sleep.data?.snoring,
				snoringEpisodes: sleep.data?.snoringepisodecount,
				...(sleepLag !== undefined && { sleepLag })
			},
			metadata: {
				enddate: sleep.enddate,
				modified: sleep.modified,
				model: sleep.model
			}
		};
	});
}

/**
 * Map Withings workout category codes to readable sport types
 */
export function getSportType(category: number): string {
	const sportMap: Record<number, string> = {
		1: 'walking',
		2: 'running',
		3: 'hiking',
		4: 'skating',
		5: 'bmx',
		6: 'cycling',
		7: 'swimming',
		8: 'surfing',
		9: 'kitesurfing',
		10: 'windsurfing',
		11: 'tennis',
		12: 'table_tennis',
		13: 'squash',
		14: 'badminton',
		15: 'lift_weights',
		16: 'calisthenics',
		17: 'elliptical',
		18: 'pilates',
		19: 'basketball',
		20: 'soccer',
		21: 'football',
		22: 'rugby',
		23: 'volleyball',
		24: 'waterpolo',
		25: 'horse_riding',
		26: 'golf',
		27: 'yoga',
		28: 'dancing',
		29: 'boxing',
		30: 'fencing',
		31: 'wrestling',
		32: 'martial_arts',
		33: 'skiing',
		34: 'snowboarding',
		35: 'other',
		36: 'rowing',
		37: 'zumba',
		38: 'baseball',
		39: 'handball',
		40: 'hockey',
		41: 'ice_hockey',
		42: 'climbing',
		43: 'ice_skating',
		44: 'multi_sport',
		128: 'no_activity',
		187: 'indoor_walking',
		188: 'indoor_running',
		191: 'indoor_cycling',
		272: 'e_bike',
		525: 'e_bike',
		552: 'yoga' // Withings 'stretching' — treated as yoga (mikroyoga)
	};
	const mapped = sportMap[category];
	if (!mapped) {
		console.warn(`[Withings] Unmapped workout category code: ${category}`);
		return 'unknown';
	}
	return mapped;
}

/**
 * Nedre troverdige snittfart (m/s) for en (el-)sykkeløkt. Under dette er det i praksis
 * umulig for en sykkel — særlig en el-sykkel med motorhjelp. Withings' egen
 * aktivitetsgjenkjenning feilstempler av og til langsom gange som «E-Biking»
 * (kategori 272/525): en bratt gåtur med mye høydemeter (f.eks. 700 hm på 3 km) gir lav
 * luftlinjefart, og bevegelsesmønsteret kan treffe sykkel-heuristikken. ~7 km/t ligger
 * godt under enhver ekte sykkeltur, men klart over rask gange.
 */
export const MIN_PLAUSIBLE_CYCLING_SPEED_MPS = 1.95; // ~7 km/t

/**
 * Korrigerer en Withings-sporttype når fartsprofilen gjør den umulig. I dag kun
 * sykkel-familien → gange: en (el-)sykkel som «beveget seg» i gangtempo er en
 * feilstemplet gåtur. Ren funksjon (testbar). Returnerer sporttypen uendret når vi
 * mangler grunnlag (for kort distanse eller manglende varighet til å stole på farten)
 * eller farten er troverdig — så ekte sykkelturer aldri berøres.
 *
 * Ved kilden er billigst: reklassifiseringen forplanter seg til klynging, canonical
 * workouts, effort og treningsprogram, og lar den korrigerte gåturen smelte sammen med
 * en evt. GPS-økt fra Ekko i samme walking-familie i stedet for å bli en falsk tvilling.
 */
export function plausibleSportType(
	sportType: string,
	distanceMeters: number | null | undefined,
	durationSeconds: number | null | undefined
): string {
	if (sportType !== 'cycling' && sportType !== 'e_bike') return sportType;
	// For lite/kort til å stole på farten — la den stå.
	if (!distanceMeters || distanceMeters < 500) return sportType;
	if (!durationSeconds || durationSeconds <= 0) return sportType;
	const speedMps = distanceMeters / durationSeconds;
	if (speedMps >= MIN_PLAUSIBLE_CYCLING_SPEED_MPS) return sportType;
	console.warn(
		`[Withings] Reklassifiserte «${sportType}» → «walking»: ${(speedMps * 3.6).toFixed(1)} km/t ` +
			`(${Math.round(distanceMeters)} m på ${Math.round(durationSeconds)} s) er umulig for sykkel.`
	);
	return 'walking';
}

/**
 * Parse Withings workout data
 * Smart filtering: Keep significant walks (>30 min or >2km), discard automatic short walks
 */
function parseWorkoutData(series: any[]): any[] {
	const filtered = series.filter((workout) => {
		const category = workout.category;
		const duration = workout.enddate - workout.startdate; // seconds
		const distance = workout.data?.distance || 0; // meters
		
		const isWalking = category === 1 || category === 187 || category === 128;
		
		if (isWalking) {
			// Keep significant walks: longer than 30 minutes OR longer than 2km
			const isSignificantWalk = duration > 1800 || distance > 2000;
			return isSignificantWalk;
		}
		
		// Keep all non-walking workouts
		return true;
	});
	
	const filteredOutCount = series.length - filtered.length;
	if (filteredOutCount > 0) {
		console.log(`   Filtered ${filteredOutCount} short walking workouts (${filtered.length} remaining)`);
	}
	
	return filtered.map((workout) => {
		const duration = workout.enddate - workout.startdate; // seconds
		// Rå Withings-kategori → sporttype, deretter en rimelighetssjekk på farten som fanger
		// feilstemplet gange (langsom (el-)sykkel finnes ikke — se plausibleSportType).
		const sportType = plausibleSportType(
			getSportType(workout.category),
			workout.data?.distance,
			duration
		);

			return {
				timestamp: new Date(workout.startdate * 1000),
				data: {
					sportType,
					duration,
					distance: workout.data?.distance, // meters
					calories: workout.data?.calories,
					avgHeartRate: workout.data?.hr_average,
					maxHeartRate: workout.data?.hr_max,
					minHeartRate: workout.data?.hr_min,
					// Swimming specific
					strokes: workout.data?.strokes,
					poolLaps: workout.data?.pool_laps,
					// Elevation
					elevation: workout.data?.elevation,
					elevationMax: workout.data?.elevation_max,
					elevationMin: workout.data?.elevation_min,
				// Speed/pace
				intensity: workout.data?.intensity,
				// SPO2
				spo2Average: workout.data?.spo2_average
			},
			metadata: {
				enddate: workout.enddate,
				modified: workout.modified,
				deviceid: workout.deviceid,
				category: workout.category
			}
		};
	});
}

/**
 * Sync weight data from Withings
 */
export async function syncWeightData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null

) {
	const startdate = fullSync
		? fullSyncFloorSeconds(floor)
		: lastSync
			? Math.floor(lastSync.getTime() / 1000)
			: undefined;
	const enddate = toDate ? Math.floor(toDate.getTime() / 1000) : undefined;

	console.log(`   Fetching weight data${startdate ? ` from ${new Date(startdate * 1000).toISOString().split('T')[0]}` : ''}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastypes: WITHINGS_BODY_MEASTYPES,
		category: 1, // Real measurements
		startdate,
		enddate
	});

	console.log(`   Parsing ${data.length} weight measurements...`);
	const parsed = parseWeightData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} weight events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'measurement',
				dataType: 'weight',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_weight'
			})),
			{ conflictMode: 'ignore' }
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} weight events...`);
		}
	}

	return parsed.length;
}

/**
 * Withings' målingstype for VO2max i Measure-API-et.
 *
 * NB: verdien er IKKE bekreftet mot dokumentasjonen fra vår side — den er lagt
 * inn for å svare empirisk på om vi i det hele tatt får noe. Derfor logges det rå
 * svaret, og verdier utenfor menneskelig VO2max-område forkastes framfor å lagres
 * (`isPlausibleVo2max`). Kommer det blodtrykk eller millisekunder ut av 123, ser
 * vi det i loggen og lagrer ingenting.
 */
const WITHINGS_MEASTYPE_VO2MAX = 123;

/**
 * Alle tre temperaturtypene i ett kall. `meastypes` (flertall) er kommaseparert —
 * samme felle som batch-prefetchen gikk i da den ba om `meastype: 1` alene.
 */
const WITHINGS_TEMPERATURE_MEASTYPE_LIST = Object.values(WITHINGS_TEMPERATURE_MEASTYPES).join(',');

/**
 * Henter VO2max fra Withings, hvis enheten produserer det.
 *
 * Eget kall framfor å utvide vekt-kallet med `meastypes`: vektsynken er den
 * viktigste stien vi har, og et feil målingsnummer eller en API-endring skal
 * ikke kunne velte den. Kallstedet pakker denne i try/catch av samme grunn.
 *
 * Bare ScanWatch-familien beregner VO2max, og bare fra økter du har hatt klokka
 * på. Har brukeren bare vekta, returnerer dette 0 for alltid — som er et gyldig
 * svar, ikke en feil.
 */
export async function syncVo2maxData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date | null,
	fullSync = false,
	toDate?: Date | null,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null
): Promise<number> {
	const startdate = fullSync
		? fullSyncFloorSeconds(floor)
		: lastSync
			? Math.floor(lastSync.getTime() / 1000)
			: undefined;
	const enddate = toDate ? Math.floor(toDate.getTime() / 1000) : undefined;

	const data = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastype: WITHINGS_MEASTYPE_VO2MAX,
		category: 1,
		startdate,
		enddate
	});

	// Meastype 123 er bekreftet å være Withings' «Treningsnivå»: vår lagrede verdi
	// 42,8 for 2026-07-25T14:42:00Z er samme minutt og samme tall som appen viser
	// (43 for 25.07.2026 16:42 Oslo). Rå-loggingen som sto her for å avgjøre det er
	// derfor fjernet.
	if (data.length === 0) {
		console.log(`   [vo2max] Ingen målinger fra meastype ${WITHINGS_MEASTYPE_VO2MAX} i vinduet.`);
		return 0;
	}

	const parsed = data.flatMap((grp: any) => {
		const measure = grp.measures?.find((m: any) => m.type === WITHINGS_MEASTYPE_VO2MAX);
		if (!measure) return [];
		const value = measure.value * Math.pow(10, measure.unit);
		if (!isPlausibleVo2max(value)) {
			console.warn(
				`   [vo2max] Forkastet verdi ${value} (rå: value=${measure.value} unit=${measure.unit}) — utenfor ${VO2MAX_MIN}–${VO2MAX_MAX} ml/kg/min.`
			);
			return [];
		}
		return [
			{
				timestamp: new Date(grp.date * 1000),
				data: { vo2max: Math.round(value * 10) / 10 },
				metadata: { grpid: grp.grpid, deviceid: grp.deviceid, meastype: WITHINGS_MEASTYPE_VO2MAX }
			}
		];
	});

	if (parsed.length === 0) return 0;

	await SensorEventService.writeMany(
		parsed.map((event) => ({
			userId,
			sensorId,
			eventType: 'measurement',
			dataType: 'vo2max',
			timestamp: event.timestamp,
			data: event.data,
			metadata: event.metadata,
			source: 'withings_sync_vo2max'
		})),
		{ conflictMode: 'ignore' }
	);

	return parsed.length;
}

/**
 * Temperatur, i et EGET kall — og med de to størrelsene holdt fra hverandre.
 *
 * ## Hvorfor det ikke kan ligge i vekt-kallet
 *
 * `parseWeightData` filtrerer gruppene på `MEASTYPE.weight`
 * (`.filter((grp) => grp.measures?.some((m) => m.type === MEASTYPE.weight))`).
 * En temperaturmåling har ingen vekt i gruppa, så den ville blitt kastet i sin
 * helhet — stille. Samme grunn som VO2max har sitt eget kall.
 *
 * ## Hvorfor to datatyper og ikke én
 *
 * Termometeret (Thermo, wifi) leser kjernetemperatur; klokka leser
 * HUDtemperatur på håndleddet, som ligger flere grader lavere. Lagret som én
 * «temperature» ville serien hatt 34,2 og 38,9 side om side, og hver trend over
 * den vært tull. Se `$lib/domain/health/temperature.ts` for hele begrunnelsen —
 * det er samme felle som `hr_min`/`hr_average` og meastype 6/8, og begge de
 * kostet en gal visning i prod.
 *
 * ## Kartet meastype → størrelse er en hypotese
 *
 * Vi vet hva Withings KALLER typene, ikke hvilken enhet som poster hvilken.
 * Derfor logges antallet per type ved hver kjøring, `metadata.meastype` følger
 * hver rad, og en verdi utenfor plausibilitetsspennet for sin størrelse
 * forkastes med rå-verdien i loggen. Bekreft mot appen før noe tolkes hardere —
 * slik meastype 123 ble bekreftet.
 *
 * Har brukeren hverken Thermo eller en klokke som måler hud, returnerer dette 0
 * for alltid. Det er et gyldig svar, ikke en feil.
 */
export async function syncTemperatureData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date | null,
	fullSync = false,
	toDate?: Date | null,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null
): Promise<number> {
	const startdate = fullSync
		? fullSyncFloorSeconds(floor)
		: lastSync
			? Math.floor(lastSync.getTime() / 1000)
			: undefined;
	const enddate = toDate ? Math.floor(toDate.getTime() / 1000) : undefined;

	const data = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastypes: WITHINGS_TEMPERATURE_MEASTYPE_LIST,
		category: 1,
		startdate,
		enddate
	});

	if (data.length === 0) {
		console.log(
			`   [temperatur] Ingen målinger fra meastypes ${WITHINGS_TEMPERATURE_MEASTYPE_LIST} i vinduet.`
		);
		return 0;
	}

	// Antall per måletype, så vi kan se hvilke enheten faktisk poster.
	const seen = new Map<number, number>();
	const parsed: Array<{
		timestamp: Date;
		dataType: string;
		data: Record<string, unknown>;
		metadata: Record<string, unknown>;
	}> = [];

	for (const grp of data as any[]) {
		for (const measure of grp.measures ?? []) {
			const kind = kindForMeastype(measure.type);
			if (!kind) continue;
			seen.set(measure.type, (seen.get(measure.type) ?? 0) + 1);

			const celsius = Math.round(measure.value * Math.pow(10, measure.unit) * 10) / 10;
			if (!isPlausibleTemperature(kind, celsius)) {
				console.warn(
					`   [temperatur] Forkastet ${kind}-verdi ${celsius} (rå: value=${measure.value} unit=${measure.unit} meastype=${measure.type}) — utenfor plausibelt spenn.`
				);
				continue;
			}

			parsed.push({
				timestamp: new Date(grp.date * 1000),
				// Størrelsen er en del av datatypen, ikke et valgfritt metadatafelt.
				dataType: kind === 'skin' ? 'skin_temperature' : 'body_temperature',
				data: { celsius },
				metadata: { grpid: grp.grpid, deviceid: grp.deviceid, meastype: measure.type }
			});
		}
	}

	if (seen.size > 0) {
		const summary = [...seen.entries()].map(([type, n]) => `${type}:${n}`).join(' ');
		console.log(`   [temperatur] Målinger per meastype — ${summary}`);
	}

	if (parsed.length === 0) return 0;

	await SensorEventService.writeMany(
		parsed.map((event) => ({
			userId,
			sensorId,
			eventType: 'measurement' as const,
			dataType: event.dataType,
			timestamp: event.timestamp,
			data: event.data,
			metadata: event.metadata,
			source: 'withings_sync_temperature'
		})),
		{ conflictMode: 'ignore' }
	);

	return parsed.length;
}

/**
 * Sync activity data from Withings
 * 
 * Note: Withings updates activity data retroactively throughout the day.
 * We use a 7-day overlap window to catch late updates.
 */
export async function syncActivityData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null

) {
	// Incremental sync: always fetch last 7 days to catch retroactive updates
	const startdateymd = fullSync
		? resolveFullSyncFloor(floor)
		: (() => {
			const overlapDate = new Date();
			overlapDate.setDate(overlapDate.getDate() - 7); // 7-day overlap window
			return overlapDate.toISOString().split('T')[0];
		})();
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

	console.log(`   Fetching activity data from ${startdateymd}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getactivity',
		data_fields: WITHINGS_ACTIVITY_DATA_FIELDS,
		startdateymd,
		enddateymd
	});

	console.log(`   Parsing ${data.length} activity records...`);
	const parsed = parseActivityData(data);

	// Store events in batches for performance
	// Use onConflictDoUpdate to capture retroactive data corrections from Withings
	console.log(`   Storing ${parsed.length} activity events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);

		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'activity',
				dataType: 'activity',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_activity'
			})),
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
		);
		
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} activity events...`);
		}
	}

	return parsed.length;
}

// Withings' /v2/sleep?action=getsummary returns only the durations by default.
// Optional fields like hr_average / sleep_score must be requested explicitly via
// data_fields, otherwise they arrive as undefined and we end up depending on the
// withings_sleep_hr backfill to patch them in later.
/**
 * Feltene vi historisk har hentet. Beholdes som reserve: skulle Withings avvise
 * et av de nye feltene, faller synken tilbake hit framfor å miste søvndata helt.
 */
const WITHINGS_SLEEP_FIELDS_LEGACY = [
	'total_sleep_time',
	'deepsleepduration',
	'lightsleepduration',
	'remsleepduration',
	'wakeupduration',
	'sleep_score',
	'hr_average',
	'rr_average'
];

/**
 * Feltene vi ber om nå.
 *
 * `sleep_latency` (tid brukt på å sovne) og `waso` (wake after sleep onset) er de
 * to Withings måler som svarer på nøyaktig det den manuelle søvnloggeren spør om
 * — «fikk ikke sove» og «våknet og fikk ikke sove igjen». De har vært
 * tilgjengelige hele tiden uten at vi har bedt om dem.
 *
 * `hr_min` er dessuten en bedre hvilepuls enn `hr_average`, som
 * `getEffortBaseline` bruker i dag med et 30–80-filter som proxy.
 */
const WITHINGS_SLEEP_DATA_FIELDS = [
	...WITHINGS_SLEEP_FIELDS_LEGACY,
	'sleep_latency',
	'wakeup_latency',
	'waso',
	'out_of_bed_count',
	'sleep_efficiency',
	'hr_min',
	'hr_max',
	// Pusteforstyrrelser og snorking. Apné-indeksen er hendelser per time; over 5
	// er klinisk grense for mild apné. Vi tolker ingenting medisinsk av det, men
	// et tall som ligger og vokser er verdt å se ved siden av søvnscoren.
	'apnea_hypopnea_index',
	'breathing_disturbances_intensity',
	'snoring',
	'snoringepisodecount'
].join(',');

/**
 * Sync sleep data from Withings
 */
export async function syncSleepData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null

) {
	const startdateymd = fullSync
		? resolveFullSyncFloor(floor)
		: lastSync
			? lastSync.toISOString().split('T')[0]
			: undefined;
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

	console.log(`   Fetching sleep data${startdateymd ? ` from ${startdateymd}` : ''}...`);
	// Use fetchWithingsSleep directly since sleep API is different
	/**
	 * Henter alle sider med et gitt feltsett.
	 *
	 * Skilt ut for å kunne forsøke det utvidede feltsettet først og falle tilbake
	 * på det historiske hvis Withings avviser et av de nye feltene. Å miste all
	 * søvndata fordi vi ba om ett ukjent felt ville vært en dyr måte å lære det på.
	 */
	async function fetchAllSleepPages(dataFields: string): Promise<any[]> {
		const collected: any[] = [];
		let offset = 0;
		let hasMore = true;
		let page = 0;

		while (hasMore && page < 100) {
			page++;
			const response = await fetchWithingsSleep(accessToken, {
				action: 'getsummary',
				startdateymd,
				enddateymd,
				offset,
				data_fields: dataFields
			});

			if (response.status !== 0) {
				throw new Error(`Withings sleep API error: ${response.error || 'Unknown error'}`);
			}

			const batch = response.body.series || [];
			collected.push(...(Array.isArray(batch) ? batch : []));
			hasMore = response.body.more || false;
			offset = response.body.offset || 0;
		}

		return collected;
	}

	let allData: any[];
	try {
		allData = await fetchAllSleepPages(WITHINGS_SLEEP_DATA_FIELDS);
		// Logg én gang hva vi faktisk fikk av de nye feltene, slik at spørsmålet
		// «leverer enheten innsovningstid?» besvares av loggen og ikke av gjetning.
		const sample = allData.find((s: any) => s?.data);
		if (sample) {
			const present = [
				'sleep_latency',
				'waso',
				'out_of_bed_count',
				'sleep_efficiency',
				'hr_min',
				'apnea_hypopnea_index',
				'breathing_disturbances_intensity',
				'snoring',
				'snoringepisodecount'
			].filter((f) => sample.data[f] !== undefined);
			console.log(
				`   [søvnfelt] Nye felter til stede: ${present.length ? present.join(', ') : 'ingen — enheten leverer dem ikke'}`
			);
		}
	} catch (err) {
		console.warn(
			`[withings-sync] Utvidet søvn-feltsett avvist, faller tilbake til det historiske: ${err instanceof Error ? err.message : String(err)}`
		);
		allData = await fetchAllSleepPages(WITHINGS_SLEEP_FIELDS_LEGACY.join(','));
	}
	console.log(`   Got ${allData.length} sleep sessions`);

	console.log(`   Parsing ${allData.length} sleep sessions...`);
	const parsed = parseSleepData(allData);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} sleep events in database...`);
	const batchSize = 100;
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);
		await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'measurement',
				dataType: 'sleep',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_sleep'
			})),
			{ conflictMode: 'ignore' }
		);
		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} sleep events...`);
		}
	}

	return parsed.length;
}

// Withings' /v2/measure?action=getworkouts only populates `data.*` fields that
// are explicitly requested via `data_fields`. Without this, distance/calories/HR
// fall back to (or get omitted as) tiny placeholder values — e.g. a 9.18 km
// e-bike trip surfaced as ~80 m.
const WITHINGS_WORKOUT_DATA_FIELDS = [
	'calories',
	'intensity',
	'manual_distance',
	'manual_calories',
	'hr_average',
	'hr_min',
	'hr_max',
	'hr_zone_0',
	'hr_zone_1',
	'hr_zone_2',
	'hr_zone_3',
	'pause_duration',
	'algo_pause_duration',
	'spo2_average',
	'steps',
	'distance',
	'elevation',
	'pool_laps',
	'strokes',
	'pool_length'
].join(',');

/**
 * Sync workout data from Withings
 *
 * Note: Uses 7-day overlap window to catch retroactive updates.
 */
export async function syncWorkoutData(
	userId: string,
	accessToken: string,
	sensorId: string,
	lastSync?: Date,
	fullSync = false,
	toDate?: Date,
	/** Gulv for full sync, `YYYY-MM-DD`. Default `WITHINGS_FULL_SYNC_DEFAULT_FLOOR`. */
	floor?: string | null

) {
	// Incremental sync: always fetch last 7 days to catch retroactive updates
	const startdateymd = fullSync
		? resolveFullSyncFloor(floor)
		: (() => {
			const overlapDate = new Date();
			overlapDate.setDate(overlapDate.getDate() - 7); // 7-day overlap window
			return overlapDate.toISOString().split('T')[0];
		})();
	const enddateymd = toDate ? toDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

	console.log(`   Fetching workout data from ${startdateymd}...`);
	const data = await fetchAllWithingsData(accessToken, {
		action: 'getworkouts',
		startdateymd,
		enddateymd,
		data_fields: WITHINGS_WORKOUT_DATA_FIELDS
	});

	console.log(`   Parsing ${data.length} workouts...`);
	const parsed = parseWorkoutData(data);

	// Store events in batches for performance
	console.log(`   Storing ${parsed.length} workout events in database...`);
	const batchSize = 100;
	// Bare de NYE radene mates til `runAfterWorkoutWrite`, som trenger øktenes
	// egne tidsstempler for å regne om riktig dag og uke.
	//
	// Filteret på `wasExisting` er det som holder cronen billig: den inkrementelle
	// synken henter 7 dagers overlapp hvert 5. minutt for å fange retroaktive
	// revisjoner, så uten det ville hver kjøring dratt med seg en re-aggregering
	// av en hel uke. Prisen er at en revidert økt ikke re-aggregeres før
	// nattjobben — projeksjonen oppdateres uansett, og det er den øktlistene leser.
	const writtenEventIds: string[] = [];
	const writtenTimestamps: Date[] = [];
	for (let i = 0; i < parsed.length; i += batchSize) {
		const batch = parsed.slice(i, i + batchSize);

		const results = await SensorEventService.writeMany(
			batch.map((event) => ({
				userId,
				sensorId,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: event.timestamp,
				data: event.data,
				metadata: event.metadata,
				source: 'withings_sync_workout'
			})),
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
		);

		for (const row of results) {
			if (!row.event?.id || row.wasExisting) continue;
			writtenEventIds.push(row.event.id);
			writtenTimestamps.push(row.event.timestamp);
		}

		if (i % 500 === 0 && i > 0) {
			console.log(`      Stored ${i}/${parsed.length} workout events...`);
		}
	}

	return { count: parsed.length, eventIds: writtenEventIds, timestamps: writtenTimestamps };
}

/**
 * Full sync of all Withings data
 */
export async function syncAllWithingsData(
	...args: Parameters<typeof runWithingsSync>
): ReturnType<typeof runWithingsSync> {
	try {
		return await runWithingsSync(...args);
	} catch (err) {
		await recordSensorSyncFailure(args[0], 'withings', err);
		throw err;
	}
}

async function runWithingsSync(
	userId: string,
	fullSync = false,
	overrideLastSync?: Date,
	overrideToDate?: Date,
	/**
	 * Gulv for full sync, `YYYY-MM-DD`. Uten dette brukes
	 * `WITHINGS_FULL_SYNC_DEFAULT_FLOOR` — se den for hvorfor datoen ikke lenger er
	 * hardkodet i fem funksjoner.
	 */
	floor?: string | null
): Promise<{
	weight: number;
	activity: number;
	sleep: number;
	workouts: number;
}> {
	const sensor = await getWithingsSensor(userId);

	if (!sensor) {
		throw new Error('No active Withings sensor found');
	}

	const accessToken = await getValidAccessToken(sensor);
	const lastSync = fullSync ? undefined : (overrideLastSync ?? sensor.lastSync ?? undefined);

	/**
	 * Full sync sletter Withings' egne rader før reimport.
	 *
	 * ## Feilen dette retter
	 *
	 * Slettingen var `where(eq(sensorEvents.userId, userId))` — altså ALLE
	 * sensorhendelser for brukeren, uansett kilde. Den tok med seg hele
	 * ernæringsloggen, sultmeldingene, manuelle søvnlogger, dupper, Strava, Tesla og
	 * skjermtid. Ingenting av det manuelt loggede kan hentes inn igjen: det finnes
	 * ikke hos noen leverandør, bare hos oss.
	 *
	 * Og knappen som utløste det står i `/settings/sources`, ett trykk unna, merket
	 * som en importvalgmulighet. Den som ville ha lengre historikk mistet i stedet
	 * all historikk som ikke kunne hentes på nytt.
	 *
	 * Slettingen er nødvendig — `conflictMode: 'ignore'` oppdaterer ikke
	 * eksisterende rader, så en reparse etter en parserfiks krever at de gamle er
	 * borte. Men den skal ramme kilden vi reimporterer, og ingenting annet.
	 */
	if (fullSync) {
		const deleted = await db
			.delete(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.sensorId, sensor.id)))
			.returning({ id: sensorEvents.id });
		console.log(`🗑️  Full sync: slettet ${deleted.length} Withings-hendelser før reimport`);

		/**
		 * Aggregatene slettes i sin helhet, og det er greit: de er utledet, og
		 * kallstedet kjører `aggregateAllPeriods` etterpå. En rad der kan ikke
		 * scopes til én kilde — den bærer metrikker fra alle.
		 */
		await db.delete(sensorAggregates).where(eq(sensorAggregates.userId, userId));
		console.log('   ✓ Aggregater slettet, bygges opp igjen av kallstedet');
	}

	// Sync all data types
	console.log('📊 Syncing weight data...');
	const weight = await syncWeightData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
	console.log(`   ✓ Synced ${weight} weight measurements`);

	// VO2max er best-effort: bare noen Withings-enheter produserer det, og
	// målingsnummeret er ikke bekreftet. En feil her skal ikke stoppe synken.
	let vo2max = 0;
	try {
		vo2max = await syncVo2maxData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
		if (vo2max > 0) console.log(`   ✓ Synced ${vo2max} VO2max measurements`);
	} catch (err) {
		console.warn(
			`[withings-sync] VO2max-synk feilet (ufarlig) user=${userId}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// Temperatur er best-effort av samme grunn som VO2max: den krever Thermo
	// eller en klokke som måler hudtemperatur, og kartet meastype → størrelse er
	// ikke bekreftet mot ekte data ennå. En feil her skal ikke stoppe synken.
	let temperature = 0;
	try {
		temperature = await syncTemperatureData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
		if (temperature > 0) console.log(`   ✓ Synced ${temperature} temperature measurements`);
	} catch (err) {
		console.warn(
			`[withings-sync] Temperatur-synk feilet (ufarlig) user=${userId}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	console.log('🏃 Syncing activity data...');
	const activity = await syncActivityData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
	console.log(`   ✓ Synced ${activity} activity records`);

	console.log('😴 Syncing sleep data...');
	const sleep = await syncSleepData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
	console.log(`   ✓ Synced ${sleep} sleep sessions`);

	console.log('💪 Syncing workout data...');
	const workoutSync = await syncWorkoutData(userId, accessToken, sensor.id, lastSync, fullSync, overrideToDate, floor);
	const workouts = workoutSync.count;
	console.log(`   ✓ Synced ${workouts} workouts`);

	// Etterbehandlingen er felles med Ekko-opplastingen og Dropbox-importen —
	// se docs/changelog/2026-08-10-en-vei-inn-for-nye-okter.md. Blokka lå
	// duplisert her fram til august 2026, og aggregeringen manglet helt, så
	// form- og belastningskortene ventet på nattjobben uansett kilde.
	//
	// `notify: false`: Withings beholder sin egen, bevisst smale varsling
	// (`notifyWithingsSyncResults` — yoga og vekt). Klokka registrerer gåturer
	// og småøkter av seg selv, og et varsel per stykk ville blitt støy.
	if (workoutSync.eventIds.length > 0) {
		await runAfterWorkoutWrite({
			userId,
			eventIds: workoutSync.eventIds,
			timestamps: workoutSync.timestamps,
			appUrl: null,
			source: 'withings_sync',
			notify: false
		});

		// Køede jobber beholdes som sikkerhetsnett: feiler et steg over, tar
		// bakgrunnskøen det på neste kjøring.
		const todayOslo = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const now = new Date();
		const dayOfWeek = now.getUTCDay() || 7; // Mon=1 … Sun=7
		const weekStart = new Date(now);
		weekStart.setUTCDate(now.getUTCDate() - dayOfWeek + 1);
		weekStart.setUTCHours(0, 0, 0, 0);
		const weekEnd = new Date(weekStart);
		weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

		await enqueueBackgroundJob({
			userId,
			type: 'checklist_autocheck',
			payload: { date: todayOslo },
			priority: 1
		});

		await enqueueBackgroundJob({
			userId,
			type: 'sync_sensor_to_task_progress',
			payload: {
				weekStart: weekStart.toISOString(),
				weekEnd: weekEnd.toISOString()
			},
			priority: 2
		});
	}

	// HRV ligger ikke i getsummary, bare i action=get per dato. Selvhelende og
	// takstyrt av samme grunn som pulsfallet under.
	try {
		const hrv = await syncSleepHrv(userId, accessToken);
		if (hrv.stored > 0 || hrv.missing > 0) {
			console.log(
				`   ✓ HRV: ${hrv.stored} netter lagret av ${hrv.missing} manglende (${hrv.fetches} kall, ${hrv.unavailable} uten SDNN, ${hrv.deferred} utsatt)`
			);
		}
	} catch (err) {
		console.warn(
			`[withings-sync] HRV-synk feilet (ufarlig) user=${userId}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// Pulsfall regnes til slutt, og er selvhelende: den ser på de siste ukene og
	// fyller hullene. Det er nødvendig fordi canonical_workouts bygges av en
	// projeksjonsjobb *etter* at øktene er skrevet — en beregning som krevde
	// ferske canonical-rader ville alltid ligge én synk bak. Best-effort: en feil
	// her skal ikke velte resten.
	try {
		const hrr = await syncHrRecovery(userId, accessToken, sensor.id);
		if (hrr.computed > 0 || hrr.missing > 0) {
			console.log(
				`   ✓ Pulsfall: ${hrr.computed} beregnet av ${hrr.missing} manglende (${hrr.fetches} intraday-kall, ${hrr.unmeasurable} uten brukbart fall, ${hrr.deferred} utsatt)`
			);
		}
	} catch (err) {
		console.warn(
			`[withings-sync] HRR-beregning feilet (ufarlig) user=${userId}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// Update last sync timestamp. `lastError: null` hører HER: skriver vi en feil
	// ved fall, må en vellykket kjøring rydde den bort, ellers står feilen fra i
	// forrige uke og sier at noe er galt lenge etter at det er rettet.
	await db
		.update(sensors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date(),
			lastError: null
		})
		.where(eq(sensors.id, sensor.id));

	return { weight, activity, sleep, workouts };
}

// ─── Prefetch support ────────────────────────────────────────────────────────

export type WithingsParsedEvent = {
	timestamp: Date | string;
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
};

export type WithingsPrefetchedDay = {
	weight: WithingsParsedEvent[];
	activity: WithingsParsedEvent[];
	sleep: WithingsParsedEvent[];
	workouts: WithingsParsedEvent[];
};

function groupEventsByDay(events: WithingsParsedEvent[]): Record<string, WithingsParsedEvent[]> {
	const byDay: Record<string, WithingsParsedEvent[]> = {};
	for (const event of events) {
		const day = new Date(event.timestamp as string).toISOString().slice(0, 10);
		(byDay[day] ??= []).push(event);
	}
	return byDay;
}

/**
 * Fetches all Withings data for the given date range in one shot (4 API calls total),
 * groups events by calendar day, and returns the result for embedding in the batch job payload.
 * Each subsequent processDay step can then write events without any external API calls.
 */
export async function prefetchWithingsEventsForRange(
	userId: string,
	fromDate: string,
	toDate: string
): Promise<{ sensorId: string; byDay: Record<string, WithingsPrefetchedDay> }> {
	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw new Error('Ingen Withings-sensor funnet');
	const accessToken = await getValidAccessToken(sensor);

	const fromUnix = Math.floor(new Date(`${fromDate}T00:00:00Z`).getTime() / 1000);
	const toUnix = Math.floor(new Date(`${toDate}T23:59:59Z`).getTime() / 1000);

	const [rawWeight, rawActivity, rawWorkouts] = await Promise.all([
		/**
		 * `meastypes` (flertall), ikke `meastype: 1`.
		 *
		 * Batch-importen ba bare om måletype 1 — vekttallet — mens hovedsynken ber om
		 * hele settet (fettprosent, fettmasse, muskel, bein, hydrering, punktpuls). En
		 * dag importert gjennom batchen kom derfor inn UTEN kroppssammensetning, og
		 * siden `conflictMode: 'ignore'` ikke oppdaterer eksisterende rader, ble den
		 * stående vekt-bare for alltid.
		 *
		 * Ingen la merke til det fordi hovedsynken dekker de ferske dagene. Feilen
		 * viser seg først ved en backfill av gamle år — altså nøyaktig når man bruker
		 * batchen til det den er for.
		 */
		fetchAllWithingsData(accessToken, {
			action: 'getmeas',
			meastypes: WITHINGS_BODY_MEASTYPES,
			category: 1,
			startdate: fromUnix,
			enddate: toUnix
		}),
		fetchAllWithingsData(accessToken, { action: 'getactivity', startdateymd: fromDate, enddateymd: toDate }),
		fetchAllWithingsData(accessToken, { action: 'getworkouts', startdateymd: fromDate, enddateymd: toDate, data_fields: WITHINGS_WORKOUT_DATA_FIELDS })
	]);

	const rawSleep: any[] = [];
	let offset = 0;
	let hasMore = true;
	let page = 0;
	while (hasMore && page < 100) {
		page++;
		const response = await fetchWithingsSleep(accessToken, { action: 'getsummary', startdateymd: fromDate, enddateymd: toDate, offset });
		if (response.status !== 0) throw new Error(`Withings sleep API error: ${response.error || 'Unknown'}`);
		rawSleep.push(...(response.body.series || []));
		hasMore = response.body.more || false;
		offset = response.body.offset || 0;
	}

	const weightByDay = groupEventsByDay(parseWeightData(rawWeight));
	const activityByDay = groupEventsByDay(parseActivityData(rawActivity));
	const sleepByDay = groupEventsByDay(parseSleepData(rawSleep));
	const workoutsByDay = groupEventsByDay(parseWorkoutData(rawWorkouts));

	const allDays = new Set([...Object.keys(weightByDay), ...Object.keys(activityByDay), ...Object.keys(sleepByDay), ...Object.keys(workoutsByDay)]);

	const byDay: Record<string, WithingsPrefetchedDay> = {};
	for (const day of allDays) {
		byDay[day] = {
			weight: weightByDay[day] ?? [],
			activity: activityByDay[day] ?? [],
			sleep: sleepByDay[day] ?? [],
			workouts: workoutsByDay[day] ?? []
		};
	}

	return { sensorId: sensor.id, byDay };
}

/**
 * Writes pre-fetched Withings events for one day to the database.
 * No external API calls — all data comes from the prefetched payload.
 */
export async function writeWithingsDayFromPrefetch(
	userId: string,
	sensorId: string,
	dayData: WithingsPrefetchedDay
): Promise<{ weight: number; activity: number; sleep: number; workouts: number; total: number }> {
	const batchSize = 100;

	async function writeBatch(
		events: WithingsParsedEvent[],
		eventType: string,
		dataType: string,
		source: string,
		conflictMode: 'ignore' | 'upsert_sensor_datatype_timestamp'
	) {
		for (let i = 0; i < events.length; i += batchSize) {
			await SensorEventService.writeMany(
				events.slice(i, i + batchSize).map((event) => ({
					userId,
					sensorId,
					eventType,
					dataType,
					timestamp: new Date(event.timestamp as string),
					data: event.data,
					metadata: event.metadata,
					source
				})),
				{ conflictMode }
			);
		}
		return events.length;
	}

	const weight = await writeBatch(dayData.weight, 'measurement', 'weight', 'withings_backfill_weight', 'ignore');
	const activity = await writeBatch(dayData.activity, 'activity', 'activity', 'withings_backfill_activity', 'upsert_sensor_datatype_timestamp');
	const sleep = await writeBatch(dayData.sleep, 'measurement', 'sleep', 'withings_backfill_sleep', 'ignore');
	const workouts = await writeBatch(dayData.workouts, 'activity', 'workout', 'withings_backfill_workout', 'upsert_sensor_datatype_timestamp');

	return { weight, activity, sleep, workouts, total: weight + activity + sleep + workouts };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute hr_average for one calendar date by calling Withings get endpoint,
 * then patch matching sleep events in the DB that are missing hr_average.
 * Returns { found, updated, hrAverage } for that date.
 */
export async function backfillSleepHrForDate(
	userId: string,
	accessToken: string,
	date: string // 'YYYY-MM-DD'
): Promise<{ found: number; updated: number; hrAverage: number | null }> {
	const dayStart = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
	const dayEnd = Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);

	const response = await fetchWithingsSleep(accessToken, {
		action: 'get',
		startdate: dayStart,
		enddate: dayEnd,
		// Bare hr: HRV eies av syncSleepHrv, som faktisk lagrer den. Dette kallet
		// ba historisk om sdnn_1 og kastet den.
		data_fields: 'hr'
	});

	if (response?.status !== 0) {
		throw new Error(`Withings get error for ${date}: ${response?.error ?? response?.status}`);
	}

	const segments: any[] = response?.body?.series ?? [];

	// hr per segment is { "unixTimestamp": bpmValue } — collect all values
	const allBpm: number[] = [];
	for (const seg of segments) {
		if (seg.hr && typeof seg.hr === 'object') {
			for (const bpm of Object.values(seg.hr)) {
				if (typeof bpm === 'number' && bpm > 0) allBpm.push(bpm);
			}
		}
	}

	const hrAverage = allBpm.length > 0
		? Math.round(allBpm.reduce((a, b) => a + b, 0) / allBpm.length)
		: null;

	if (hrAverage === null) {
		return { found: 0, updated: 0, hrAverage: null };
	}

	// Find sleep events for this UTC day missing hr_average
	const windowStart = new Date(`${date}T00:00:00Z`);
	const windowEnd = new Date(`${date}T23:59:59Z`);

	const events = await db
		.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, windowStart),
				lt(sensorEvents.timestamp, windowEnd)
			)
		);

	if (events.length === 0) {
		return { found: 0, updated: 0, hrAverage };
	}

	// Merge hr_average into existing JSONB without overwriting other fields
	const { pgClient } = await import('$lib/db');
	let updated = 0;
	for (const event of events) {
		await pgClient`
			UPDATE sensor_events
			SET data = data || jsonb_build_object('hr_average', ${hrAverage}::int)
			WHERE id = ${event.id}
			  AND (data->>'hr_average') IS NULL
			  -- En array-rad ville blitt konkatenert, ikke flettet. Se
			  -- withings-sleep-hrv.ts for hva det kostet sist.
			  AND jsonb_typeof(data) = 'object'
		`;
		updated++;
	}

	return { found: events.length, updated, hrAverage };
}
