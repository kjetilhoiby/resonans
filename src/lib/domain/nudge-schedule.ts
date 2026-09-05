/**
 * Når en dags-nudge er due, og om den skal være interaktiv eller en oversikt.
 *
 * Ren modul — ingen DB, ingen klokke. Skilt ut fra
 * `$lib/server/day-planning-nudges.ts` i september 2026 fordi de to feilene som
 * gjorde hele fila stum var rene regnefeil i nettopp denne logikken, og ingen
 * test kunne nå dem så lenge de lå inni en løkke over `db.query.users`.
 *
 * Se `docs/changelog/2026-09-05-krydder-paa-dagsoversikten.md`.
 */

export type DayMode = 'interactive' | 'digest';

export interface NudgeProfile {
	weekdayMode?: 'interactive' | 'digest';
	weekendMode?: 'interactive' | 'digest';
	quietHours?: { enabled?: boolean; start?: string; end?: string };
	digestTimeWeekday?: string;
	digestTimeWeekend?: string;
}

/**
 * Stillevinduet er NATTA, ikke kvelden — og det er en rettelse.
 *
 * Defaulten var `20:00`–`08:00` fram til september 2026, mens standardtidene
 * under er 07:00 for plan-dag og 21:00 for avslutt-dag. Begge lå altså INNI sitt
 * eget stillevindu, og `resolveNudgeMode` sendte dem til digest hver eneste
 * gang: de to interaktive grenene var strukturelt uoppnåelige med
 * standardinnstillinger, uten at noe sa fra. To defaults satt to steder var
 * uenige, og den ene vant stille.
 *
 * 22:00–07:00 er den definisjonen av «ikke forstyrr» som lar begge stå: en
 * avslutt-dagen-nudge kl. 21 ER en kveldsnudge, og et stillevindu som slår den
 * av har misforstått hva den er til for. Invarianten står som en test
 * (`ingen standardtid ligger i standard stillevindu`) nettopp fordi feilen er
 * usynlig: alt ser ut til å virke, det kommer bare aldri noe varsel.
 */
export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '07:00';

export const DEFAULT_PLANNING_TIME = '07:00';
export const DEFAULT_CLOSE_TIME = '21:00';
export const DEFAULT_RELATIONSHIP_MORNING_TIME = '08:30';
export const DEFAULT_DIGEST_TIME_WEEKDAY = '09:00';
export const DEFAULT_DIGEST_TIME_WEEKEND = '10:00';

/**
 * Hvor bredt et tidspunkt treffer.
 *
 * Fram til september 2026 sto gaten som en EKSAKT streng-sammenligning mot
 * Oslo-klokkeslettet. Den forutsatte at cron-tikket lander på nøyaktig det
 * minuttet, og GitHub Actions' femminutters-plan gjorde aldri det: målt lørdag
 * 29. august 2026 kjørte jobben 08:07, 08:25, 08:33, 08:41, 08:48 og 08:54 UTC.
 * Digesten (10:00 Oslo = 08:00 UTC) traff derfor ikke på flere måneder, og fyrte
 * første gang 5. september — dagen etter at den interne dispatcheren ble eneste
 * klokke og begynte å tikke 08:00:02.
 *
 * En time, fordi jobben er timebasert (`0 * * * *`): da treffer nøyaktig ett
 * tikk et hvilket som helst konfigurert klokkeslett, uansett om dispatcheren
 * ligger et minutt eller ti bak. Dedupen i kalleren gjør vinduet trygt å utvide
 * — og dekker samtidig høstens dobbelte time ved sommertidsskiftet, der samme
 * lokale klokkeslett kommer to ganger.
 */
export const NUDGE_WINDOW_MINUTES = 60;

/** `hm` inni `[start, end)`, der et vindu som krysser midnatt er lov. */
export function isTimeInWindow(hm: string, start: string, end: string) {
	if (start === end) return true;
	if (start < end) return hm >= start && hm < end;
	return hm >= start || hm < end;
}

export function isWeekend(isoDate: string) {
	const day = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
	return day === 0 || day === 6;
}

/**
 * Interaktiv nudge eller stille oversikt?
 *
 * Rekkefølgen er en prioritering: triagen (rolig-profil, lavt engasjement) slår
 * alt, så stillevinduet, så ukedagsprofilen.
 */
export function resolveNudgeMode(
	profile: NudgeProfile | undefined,
	todayIso: string,
	hm: string,
	triage: { forceDigest: boolean }
): DayMode {
	if (triage.forceDigest) return 'digest';

	const weekdayMode = profile?.weekdayMode ?? 'interactive';
	const weekendMode = profile?.weekendMode ?? 'digest';
	const baseMode: DayMode = isWeekend(todayIso) ? weekendMode : weekdayMode;

	const quietEnabled = profile?.quietHours?.enabled !== false;
	const quietStart = profile?.quietHours?.start ?? DEFAULT_QUIET_START;
	const quietEnd = profile?.quietHours?.end ?? DEFAULT_QUIET_END;

	if (quietEnabled && isTimeInWindow(hm, quietStart, quietEnd)) return 'digest';

	return baseMode;
}

export function digestTimeFor(profile: NudgeProfile | undefined, todayIso: string) {
	return isWeekend(todayIso)
		? (profile?.digestTimeWeekend ?? DEFAULT_DIGEST_TIME_WEEKEND)
		: (profile?.digestTimeWeekday ?? DEFAULT_DIGEST_TIME_WEEKDAY);
}
