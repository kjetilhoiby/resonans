/**
 * Vinduet et Withings-kall må dekke for å få *hele* natta.
 *
 * ## Feilen dette retter
 *
 * `syncSleepHrv` og `backfillSleepHrForDate` hentet ett **UTC-kalenderdøgn** per natt,
 * og nøklet natta på UTC-datoen til søvnstart. Målt på prod 5. august starter hver
 * søvnøkt mellom 20:57 og 22:54 UTC:
 *
 * ```
 * 2026-08-04T22:53Z → datonøkkel 2026-08-04 → vindu 08-04T00:00–23:59Z
 * 2026-08-03T22:16Z → datonøkkel 2026-08-03 → vindu 08-03T00:00–23:59Z
 * ```
 *
 * Natta løper fra ~22:00 UTC til ~06:00 UTC *neste* dag. Vinduet dekker altså bare den
 * første timen eller to, og resten — inkludert hele den delen Withings selv bruker til å
 * regne «gjennomsnitt siste 90 min» — faller utenfor. Withings-appen viste HRV hver natt
 * mens vår base hadde null netter med HRV på 29.
 *
 * ## Regelen
 *
 * Vinduet bygges fra søvnøkta selv, ikke fra en kalenderdato: litt før den startet, og
 * langt nok fram til at en lang natt får plass. Da er det uvesentlig hvilken side av
 * UTC-midnatt økta begynner på.
 */

/** Litt luft før innsovning, i tilfelle måleren begynte å samle før øktas starttid. */
export const NIGHT_LEAD_HOURS = 2;

/**
 * Hvor langt fram vinduet strekker seg.
 *
 * Atten timer dekker en lang natt med god margin, og holder seg samtidig innenfor ett
 * kall. Kortere ville risikert å klippe morgenen på den som sover ut.
 */
export const NIGHT_TRAIL_HOURS = 18;

export interface NightWindow {
	/** Unix-sekunder, som Withings' `startdate`. */
	startdate: number;
	enddate: number;
}

/**
 * Vinduet som dekker natta en søvnøkt tilhører.
 *
 * `starts` er tidspunktene til alle segmentene natta består av — Withings deler natta
 * når man er ute av senga, og vinduet må dekke det første og det siste.
 */
export function nightFetchWindow(starts: Date[]): NightWindow | null {
	const times = starts
		.map((date) => date.getTime())
		.filter((ms) => Number.isFinite(ms));
	if (times.length === 0) return null;

	const earliest = Math.min(...times);
	const latest = Math.max(...times);

	return {
		startdate: Math.floor((earliest - NIGHT_LEAD_HOURS * 3_600_000) / 1000),
		// Fra det *siste* segmentet, ellers kunne en natt delt i to biter der den andre
		// begynner sent falt utenfor sitt eget vindu.
		enddate: Math.ceil((latest + NIGHT_TRAIL_HOURS * 3_600_000) / 1000)
	};
}
