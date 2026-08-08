/**
 * Søvn-dashboardet oversatt til noe en modell kan svare ut fra.
 *
 * `query_sensor_data` med `metric='sleep'` gir rå søvnrader. Alt som gjør dem
 * lesbare — nattlengde per natt med dupper skilt ut, døgnrytme, sovepuls mot
 * din egen baseline, HRV, forstyrrelser, søvnmål — lå i
 * `loadSleepDashboardData` og ble bare brukt av dashboardet.
 *
 * ## Retningen er motsatt av trening
 *
 * Der VO2max og pulsfall oppsummeres av **beste** observasjon (begge forutsetter
 * maksimal innsats), måles søvn hver natt uten innsats. Da er **siste natt**
 * tallet, og baselinen er det den skal måles mot. «Beste HRV siste åtte uker» er
 * meningsløst.
 *
 * ## Absoluttverdier vises aldri alene
 *
 * HRV (SDNN) varierer for mye mellom folk til at et tall uten baseline betyr noe,
 * og det finnes ingen normtabell. `pickHrvMetric` sier `band: 'ukjent'` til den har
 * sju netter. Sammendraget bærer `band` og `deviationPct` videre nettopp så
 * modellen ikke skal begynne å tolke millisekunder på egen hånd.
 */

export interface SleepSummaryInput {
	/** Eldste først, dupper merket med `isNap`. */
	nights: Array<{ date: string; hours: number; isNap: boolean }>;
	rhythm: { bedtime: string | null; wake: string | null; avgHours: number | null; nightCount: number };
	naps: Array<{ start: string; durationMinutes: number; manual: boolean; note: string | null }>;
	disturbanceNights: Array<{
		nightKey: string;
		innsovning: number;
		oppvaakning: number;
		awakeMinutes: number | null;
	}>;
	goals: Array<{
		title: string;
		kind: string;
		evaluation: {
			/** Null uten netter i grunnlaget — «vet ikke», ikke «ikke innfridd». */
			currentLabel: string | null;
			targetLabel: string;
			withinTarget: boolean | null;
			nightCount: number;
		};
	}>;
	hrv: {
		latest: number;
		latestDate: string;
		nights: number;
		baseline: number | null;
		baselineNights: number;
		deviationPct: number | null;
		band: string;
	} | null;
	hrvAvailability: { sleepNights: number; nightsWithHrv: number };
	sleepHeartRate: {
		latest: { date: string; restingBpm: number | null; averageBpm: number | null; segments: number } | null;
		baselineBpm: number | null;
		baselineNights: number;
		deviationBpm: number | null;
		band: string;
	};
	breathing: {
		date: string;
		apneaHypopneaIndex: number | null;
		snoringMinutes: number | null;
		snoringEpisodes: number | null;
	} | null;
	latest: {
		avgHours: number | null;
		sleepLag: number | null;
		sleepHeartRate: number | null;
		disturbedNights: number | null;
		awakeMinutes: number | null;
	};
}

export type SleepQueryType = 'recent' | 'physiology' | 'disturbances';

/** Netter i `recent`. Tretti dager er leservinduet; fjorten er nok å svare fra. */
export const MAX_NIGHTS = 14;

/** Forstyrrede netter i svaret. */
export const MAX_DISTURBANCE_NIGHTS = 10;

/**
 * Én deklarert form med valgfrie seksjoner, av samme grunn som i
 * `training-summary.ts`: samme JSON, men kallstedet slipper å smalne typen først.
 */
export interface SleepSummary {
	queryType: SleepQueryType;
	coverage: { nights: number; naps: number; windowDays: number };
	/* recent */
	nights?: Array<{ date: string; hours: number }>;
	rhythm?: SleepSummaryInput['rhythm'];
	latestWeek?: SleepSummaryInput['latest'];
	naps?: Array<{ start: string; durationMinutes: number; manual: boolean; note: string | null }>;
	goals?: Array<{
		title: string;
		kind: string;
		current: string | null;
		target: string;
		withinTarget: boolean | null;
		nightCount: number;
	}>;
	disturbedNights?: number;
	/* physiology */
	sleepHeartRate?: {
		latestRestingBpm: number | null;
		latestAverageBpm: number | null;
		latestDate: string | null;
		segments: number | null;
		baselineBpm: number | null;
		baselineNights: number;
		deviationBpm: number | null;
		band: string;
	};
	hrv?: {
		latestSdnnMs: number;
		latestDate: string;
		baselineSdnnMs: number | null;
		baselineNights: number;
		deviationPct: number | null;
		band: string;
		nights: number;
	} | null;
	hrvAvailability?: SleepSummaryInput['hrvAvailability'];
	breathing?: SleepSummaryInput['breathing'];
	/**
	 * Forstyrrede netter. Eget feltnavn, ikke `nights`: de to listene har ulike felt,
	 * og gjenbrukt navn ville gitt et svar der «netter» betyr to ting.
	 */
	disturbances?: Array<{
		night: string;
		couldNotFallAsleep: number;
		wokeUp: number;
		awakeMinutes: number | null;
	}>;
	truncated?: boolean;
	source?: string;
}

export function summarizeSleepForChat(
	input: SleepSummaryInput,
	queryType: SleepQueryType = 'recent'
): SleepSummary {
	// Dupper er ikke netter, og skal ikke telle i nattsnittet.
	const realNights = input.nights.filter((n) => !n.isNap);

	const base = {
		queryType,
		coverage: {
			nights: realNights.length,
			naps: input.nights.length - realNights.length,
			windowDays: 30
		}
	};

	if (queryType === 'physiology') {
		return {
			...base,
			/**
			 * Sovepuls: `hr_min` er hvilepulsen. `hr_average` blander REM og
			 * oppvåkninger inn og ligger 5–10 slag høyere — kryssjekk, aldri hovedtall.
			 * Lav puls er bra, så en STIGNING er signalet (motsatt av VO2max).
			 */
			sleepHeartRate: {
				latestRestingBpm: input.sleepHeartRate.latest?.restingBpm ?? null,
				latestAverageBpm: input.sleepHeartRate.latest?.averageBpm ?? null,
				latestDate: input.sleepHeartRate.latest?.date ?? null,
				/** 2+ segmenter betyr at natta ble delt fordi man var ute av senga. */
				segments: input.sleepHeartRate.latest?.segments ?? null,
				baselineBpm: input.sleepHeartRate.baselineBpm,
				baselineNights: input.sleepHeartRate.baselineNights,
				/** Positivt = høyere puls enn vanlig = det som er verdt å se på. */
				deviationBpm: input.sleepHeartRate.deviationBpm,
				band: input.sleepHeartRate.band
			},
			hrv: input.hrv
				? {
						latestSdnnMs: input.hrv.latest,
						latestDate: input.hrv.latestDate,
						baselineSdnnMs: input.hrv.baseline,
						baselineNights: input.hrv.baselineNights,
						deviationPct: input.hrv.deviationPct,
						/**
						 * 'ukjent' betyr for få netter til å regne avvik. Da skal tallet
						 * ikke tolkes — heller ikke som «normalt».
						 */
						band: input.hrv.band,
						nights: input.hrv.nights
					}
				: null,
			/**
			 * Hvorfor HRV eventuelt mangler. «Ingen søvnmåling» og «søvnmåling uten
			 * HRV» er to helt ulike ting å gjøre noe med, og HRV ligger bare i
			 * Withings' `action=get` per dato — så søvn kan være synket uten at HRV er.
			 */
			hrvAvailability: input.hrvAvailability,
			breathing: input.breathing
		};
	}

	if (queryType === 'disturbances') {
		return {
			...base,
			disturbances: input.disturbanceNights.slice(0, MAX_DISTURBANCE_NIGHTS).map((n) => ({
				night: n.nightKey,
				couldNotFallAsleep: n.innsovning,
				wokeUp: n.oppvaakning,
				/** null = «vet ikke», ikke 0 minutter. Ikke gjett et tall. */
				awakeMinutes: n.awakeMinutes
			})),
			truncated: input.disturbanceNights.length > MAX_DISTURBANCE_NIGHTS,
			/**
			 * Manuelle registreringer vinner per natt; Withings' `sleep_latency`/`waso`
			 * fyller nettene man ikke logget selv. Enheten måler bevegelse, ikke
			 * opplevelsen.
			 */
			source: 'manuell logg der den finnes, ellers Withings-målt'
		};
	}

	// 'recent' — standardsvaret.
	return {
		...base,
		nights: realNights.slice(-MAX_NIGHTS).map((n) => ({ date: n.date, hours: n.hours })),
		rhythm: input.rhythm,
		latestWeek: input.latest,
		naps: input.naps.slice(0, 5).map((nap) => ({
			start: nap.start,
			durationMinutes: nap.durationMinutes,
			/** Manuelle dupper kan rettes og slettes; oppdagede er Withings-målinger. */
			manual: nap.manual,
			note: nap.note
		})),
		goals: input.goals.map((goal) => ({
			title: goal.title,
			kind: goal.kind,
			current: goal.evaluation.currentLabel,
			target: goal.evaluation.targetLabel,
			withinTarget: goal.evaluation.withinTarget,
			nightCount: goal.evaluation.nightCount
		})),
		disturbedNights: input.disturbanceNights.length
	};
}
