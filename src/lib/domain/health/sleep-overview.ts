/**
 * Ren logikk for Søvn-undertemaets dashboard.
 *
 * Primitivene (nap-inferens, medianer, målevaluering) bor i
 * `$lib/domain/sleep-goals.ts` og er testet der. Denne modulen former dem til
 * det dashboardet faktisk viser: en nattserie og en rytme-oppsummering.
 */

import {
	medianBedtimeMinutes,
	medianWakeMinutes,
	noonAxisToHHMM,
	type SleepNight
} from '$lib/domain/sleep-goals';
import { nightKeyForTime } from '$lib/domain/sleep/disturbance';
import { osloDayKey } from '$lib/domain/oslo-time';

export interface SleepNightPoint {
	/** Datoen natten regnes til (morgenen man våkner). */
	date: string;
	hours: number;
	isNap: boolean;
}

export interface SleepRhythm {
	/** Median leggetid som HH:MM, eller null uten nok netter. */
	bedtime: string | null;
	wake: string | null;
	/** Snitt timer per natt (naps holdt utenfor). */
	avgHours: number | null;
	nightCount: number;
}

/**
 * Nøkkelen ett segment havner på.
 *
 * **En natt nøkles på `nightKeyForTime`, en dupp på Oslo-DAGEN**, og det er to
 * ulike spørsmål: en natt hører til morgenen du våkner, en dupp til dagen du
 * tok den. Grensa på 18:00 som gjør det første riktig, ville flyttet en
 * ettermiddagsdupp kl. 18 over til morgendagen.
 *
 * Fram til september 2026 sto det `end.toISOString()` her — altså UTC-datoen
 * for da segmentet SLUTTET — og det er feil på to måter samtidig:
 *
 *  1. **UTC-midnatt ligger kl. 02 om natta i Oslo om sommeren.** Deler Withings
 *     natta ved en oppvåkning rundt da (og den deler ofte), får den første
 *     halvdelen gårsdagens dato og den andre dagens. Én natt på åtte timer
 *     leses som to på fire, og siden `nightKeyForTime` er det sovepuls og HRV
 *     bruker, står søvnraden på en annen dag enn pulsraden ved siden av seg.
 *     Målt 10. september 2026: Health Mate sa 8t00 og 13t13 der forløpet viste
 *     4,5 t.
 *  2. **`end ?? start` faller tilbake på leggetiden** når `metadata.enddate`
 *     mangler, og da havner hele natta et døgn for tidlig.
 *
 * Kommentaren i `disturbance.ts` påsto at denne funksjonen alt fulgte
 * konvensjonen. Den gjorde ikke det — nå gjør den det.
 */
function segmentKey(night: SleepNight): string {
	if (night.isNap) return osloDayKey(night.start);
	return nightKeyForTime(night.start) ?? osloDayKey(night.start);
}

/**
 * Netter → punktserie, eldste først. Naps merkes, men beholdes i serien slik at
 * dashboardet kan vise dem uten et eget oppslag.
 *
 * Segmenter på samme natt slås sammen, og timene summeres. Withings deler natta
 * i flere `sleep`-events når man er ute av senga (`out_of_bed_count > 0`), og da
 * er 3 t + 4 t én natt på 7 t — ikke to netter. Uten sammenslåingen fikk
 * SleepDashboard duplikate `{#each}`-nøkler og kastet `each_key_duplicate`, og
 * søylediagrammet viste to lave netter der det var én normal.
 *
 * Naps slås ikke sammen med netter: en flis om dagen og søvnen samme natt er to
 * ulike ting, og `isNap` er det som skiller dem i visningen.
 */
export function buildSleepNightSeries(nights: SleepNight[]): SleepNightPoint[] {
	const byKey = new Map<string, SleepNightPoint>();

	for (const night of nights) {
		const date = segmentKey(night);
		const hours = Math.round(night.durationH * 100) / 100;
		const key = `${date}:${night.isNap ? 'nap' : 'natt'}`;
		const existing = byKey.get(key);
		if (existing) {
			existing.hours = Math.round((existing.hours + hours) * 100) / 100;
		} else {
			byKey.set(key, { date, hours, isNap: night.isNap });
		}
	}

	return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rytme-oppsummering over de faktiske nattesøvnene. Naps er ekskludert — de
 * ville dratt både medianene og snittet feil vei.
 */
export function summarizeSleepRhythm(nights: SleepNight[]): SleepRhythm {
	const realNights = nights.filter((n) => !n.isNap);
	if (realNights.length === 0) {
		return { bedtime: null, wake: null, avgHours: null, nightCount: 0 };
	}

	const bedtimeMinutes = medianBedtimeMinutes(realNights);
	const wakeMinutes = medianWakeMinutes(realNights);
	const totalHours = realNights.reduce((sum, n) => sum + n.durationH, 0);

	return {
		bedtime: bedtimeMinutes === null ? null : noonAxisToHHMM(bedtimeMinutes),
		wake: wakeMinutes === null ? null : noonAxisToHHMM(wakeMinutes),
		avgHours: Math.round((totalHours / realNights.length) * 100) / 100,
		nightCount: realNights.length
	};
}

/**
 * Sammensatt forsinkelse: sleepLag (forskyvning fra leggetid 22–00 / våknetid
 * 06–08) pluss earlyWake. Speiler regnestykket helse-dashboardet brukte, slik
 * at tallet ikke endrer betydning når det flytter til Søvn.
 */
export function compositeSleepLag(metrics: {
	sleepLag?: number;
	earlyWake?: number;
} | null | undefined): number | null {
	const lag = typeof metrics?.sleepLag === 'number' ? metrics.sleepLag : null;
	const early = typeof metrics?.earlyWake === 'number' ? metrics.earlyWake : null;
	if (lag !== null && early !== null) return lag + early;
	if (lag !== null) return lag;
	if (early !== null) return early;
	return null;
}
