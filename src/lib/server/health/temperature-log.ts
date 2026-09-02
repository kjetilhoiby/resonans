/**
 * temperature-log.ts — leseveien for de to temperatursignalene.
 *
 * Holder dem fra hverandre hele veien, slik `temperature.ts` krever: `celsius`
 * fra `body_temperature` er kjerne (Thermo), fra `skin_temperature` er hud
 * (klokka). En felles leser som slo dem sammen ville gjort hele skillet
 * meningsløst.
 *
 * Hudtemperatur nøkles på **natta man våkner** (`nightKeyForTime`), som HRV og
 * sovepuls — klokka måler kontinuerlig, så flere målinger per natt er normalen,
 * og døgnets laveste er den sammenlignbare. Kjernemålinger er punktmålinger man
 * tar med et termometer, og nøkles på Oslo-dagen de ble tatt.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { nightKeyForTime } from '$lib/domain/sleep/disturbance';
import {
	summarizeCoreTemperature,
	summarizeSkinTemperature,
	type CoreTemperatureSummary,
	type SkinTemperatureSummary,
	type TemperatureReading
} from '$lib/domain/health/temperature';

export const CORE_TEMPERATURE_DATA_TYPE = 'body_temperature';
export const SKIN_TEMPERATURE_DATA_TYPE = 'skin_temperature';

/** Nok til en baseline på sju netter med god margin for hull. */
export const TEMPERATURE_LOOKBACK_DAYS = 30;

export interface TemperatureSummaries {
	core: CoreTemperatureSummary;
	skin: SkinTemperatureSummary;
}

export async function loadTemperature(
	userId: string,
	sinceDays: number = TEMPERATURE_LOOKBACK_DAYS
): Promise<TemperatureSummaries> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({
			dataType: sensorEvents.dataType,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.dataType, [
					CORE_TEMPERATURE_DATA_TYPE,
					SKIN_TEMPERATURE_DATA_TYPE
				]),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	const core: TemperatureReading[] = [];
	/** Flere hudmålinger per natt: vi holder den LAVESTE per natt. Se under. */
	const skinByNight = new Map<string, number>();

	for (const row of rows) {
		const celsius = (row.data as Record<string, unknown> | null)?.celsius;
		if (typeof celsius !== 'number') continue;

		if (row.dataType === CORE_TEMPERATURE_DATA_TYPE) {
			core.push({ date: osloDayKey(row.timestamp), celsius });
			continue;
		}

		/**
		 * Laveste per natt, ikke snittet.
		 *
		 * Samme valg som `hr_min` framfor `hr_average`: håndleddet varmes av
		 * dyna, av å ligge på armen, av rommet. Nattens minimum er det punktet
		 * som er mest sammenlignbart fra natt til natt — og siden vi bare bruker
		 * AVVIKET fra egen baseline, er nivået uansett ikke poenget.
		 */
		const night = nightKeyForTime(row.timestamp);
		if (!night) continue;
		const existing = skinByNight.get(night);
		if (existing === undefined || celsius < existing) skinByNight.set(night, celsius);
	}

	const skin: TemperatureReading[] = [...skinByNight.entries()].map(([date, celsius]) => ({
		date,
		celsius
	}));

	return {
		core: summarizeCoreTemperature(core),
		skin: summarizeSkinTemperature(skin)
	};
}
