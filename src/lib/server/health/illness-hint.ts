/**
 * illness-hint.ts (server) — samler signalene og spør «er du syk?».
 *
 * Beslutningen bor rent i `$lib/domain/health/illness-hint.ts`. Denne fila gjør
 * datainnhentingen og husker et avvist forslag.
 *
 * **Sovepulsen leses gjennom `loadSleepHeartRate`**, altså den samme veien
 * Søvn-flaten og `resting_hr_elevated_7d` går. En egen spørring her ville vært en
 * fjerde lesning av «hva er hvilepulsen din», og det var nettopp tre av dem som
 * gjorde signalet galt i et halvt år.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { loadSleepHeartRate } from './nightly-physiology';
import { loadTemperature } from './temperature-log';
import { getSickState, todayOsloKey } from './sick-log';
import { isDayKey } from '$lib/domain/health/sick-periods';
import {
	suggestIllness,
	type IllnessHint,
	type NightDeviation
} from '$lib/domain/health/illness-hint';

export const HINT_DISMISSED_DATA_TYPE = 'sick_hint_dismissed';

/** Vinduet signalene leses i. Nok til en baseline pluss en løpende hale. */
const HINT_LOOKBACK_DAYS = 30;

async function readDismissedOn(userId: string): Promise<string | null> {
	const rows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, HINT_DISMISSED_DATA_TYPE))
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const day = (rows[0]?.data as Record<string, unknown> | undefined)?.day;
	if (isDayKey(day)) return day;
	return rows[0] ? todayOsloKey(rows[0].timestamp) : null;
}

/** Registrer at brukeren avviste forslaget. Holder kjeft i `HINT_QUIET_DAYS`. */
export async function dismissIllnessHint(userId: string, now: Date = new Date()): Promise<void> {
	const sensor = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'tilstand_flag'))
	});
	const sensorId =
		sensor?.id ??
		(
			await db
				.insert(sensors)
				.values({
					userId,
					provider: 'tilstand_flag',
					type: 'manual_log',
					subtype: 'tilstand_flag',
					name: 'Tilstand-flagg',
					isActive: true
				})
				.returning()
		)[0].id;

	await SensorEventService.write({
		userId,
		sensorId,
		eventType: 'measurement',
		dataType: HINT_DISMISSED_DATA_TYPE,
		timestamp: now,
		data: { day: todayOsloKey(now) },
		source: 'sick_hint_ui'
	});
}

/**
 * «Er du syk?» — eller null, som er svaret nesten alltid.
 *
 * Feiler noen av kildene, returneres null framfor et forslag bygget på halve
 * grunnlaget: et spørsmål som bommer koster tilliten til alle de neste.
 */
export async function loadIllnessHint(
	userId: string,
	now: Date = new Date()
): Promise<IllnessHint | null> {
	const todayKey = todayOsloKey(now);

	const [hr, temp, sick, dismissedOn] = await Promise.all([
		loadSleepHeartRate(userId, HINT_LOOKBACK_DAYS).catch(() => null),
		loadTemperature(userId, HINT_LOOKBACK_DAYS).catch(() => null),
		getSickState(userId, now).catch(() => null),
		readDismissedOn(userId).catch(() => null)
	]);

	/**
	 * Avvik per natt mot brukerens egen baseline.
	 *
	 * Baselinen fra `summarizeSleepHeartRate` er regnet UTEN siste natt, og det er
	 * riktig for «hvordan var i natt». Her måler vi en HALE over flere netter, så
	 * hver natt måles mot den samme baselinen — ellers ville hver natt hatt sin
	 * egen, og en jevn forhøyning sett ut som ingen forhøyning.
	 */
	const restingHr: NightDeviation[] =
		hr?.baselineBpm != null
			? hr.nights
					.filter((n) => n.restingBpm !== null)
					.map((n) => ({ date: n.date, deviation: (n.restingBpm as number) - hr.baselineBpm! }))
			: [];

	const skinTemp: NightDeviation[] =
		temp?.skin.baselineC != null
			? temp.skin.readings.map((r) => ({
					date: r.date,
					deviation: Math.round((r.celsius - temp.skin.baselineC!) * 10) / 10
				}))
			: [];

	return suggestIllness({
		restingHr,
		skinTemp,
		sickActive: sick?.active ?? false,
		dismissedOn,
		todayKey
	});
}
