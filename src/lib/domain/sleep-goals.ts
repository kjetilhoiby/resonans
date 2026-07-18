/**
 * Ren søvnmål-logikk (klient-trygg, uten DB): nap-inferens, natt-mapping,
 * median leggetid/oppvåkning og målevaluering. DB-lesing bor i
 * `$lib/server/integrations/sleep-goals.ts`.
 *
 * Mål lagres i goals.metadata.sleepGoal med tre typer:
 *  - duration: måltimer søvn per natt (snitt siste 7 netter)
 *  - bedtime:  mål-leggetid HH:MM ± slingring
 *  - waketime: mål-oppvåkning HH:MM ± slingring
 */

export type SleepGoalKind = 'duration' | 'bedtime' | 'waketime' | 'nap';

export interface SleepGoal {
	kind: SleepGoalKind;
	/** duration: måltimer per natt */
	targetHours?: number;
	/** bedtime/waketime: 'HH:MM' lokal tid */
	targetTime?: string;
	/** bedtime/waketime: slingring i minutter rundt måltid (default 30) */
	toleranceMinutes?: number;
	/** nap: maks antall powernaps per uke */
	maxPerWeek?: number;
}

export const SLEEP_GOAL_DEFAULT_TOLERANCE_MIN = 30;

/** Én natt (eller nap) fra en rå 'sleep'-event. */
export interface SleepNight {
	/** Innsovning (eventens timestamp) */
	start: Date;
	/** Oppvåkning (metadata.enddate), null når ukjent */
	end: Date | null;
	/** Faktisk søvntid i timer (data.sleepDuration), fallback: start→end-spennet */
	durationH: number;
	isNap: boolean;
}

const OSLO_TZ = 'Europe/Oslo';

/** Lokal time og minutt for et tidspunkt i gitt tidssone. */
export function localHourMinute(date: Date, tz = OSLO_TZ): { hour: number; minute: number } {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(date);
	const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
	const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
	return { hour, minute };
}

/**
 * Nap-inferens: Withings sender powernaps som egne korte søvn-events uten flagg.
 * Regel: start på dagtid (09–20 lokal tid) og varighet under 3 timer → nap.
 */
export function isNap(start: Date, durationHours: number, tz = OSLO_TZ): boolean {
	if (durationHours >= 3) return false;
	const { hour } = localHourMinute(start, tz);
	return hour >= 9 && hour < 21;
}

/** Rå event-form slik den kommer fra sensor_events (og aggregation.ts). */
export interface RawSleepEventLike {
	timestamp: Date;
	data?: { sleepDuration?: number; isNap?: boolean } | null;
	/** sensor_events.metadata er løst typet i schemaet — leses med guard */
	metadata?: unknown;
}

function sleepEventEnddateSec(event: RawSleepEventLike): number | null {
	const endSec = (event.metadata as { enddate?: unknown } | null | undefined)?.enddate;
	return typeof endSec === 'number' && Number.isFinite(endSec) ? endSec : null;
}

/**
 * Er en rå 'sleep'-event en nap? Eksplisitt `data.isNap` (manuell registrering)
 * vinner over inferensen — en hvil kl. 21:30 er nap når brukeren sier det.
 * Brukes også av aggregeringen for å holde naps ute av nattsnittet.
 */
export function isNapSleepEvent(event: RawSleepEventLike, tz = OSLO_TZ): boolean {
	if (typeof event.data?.isNap === 'boolean') return event.data.isNap;
	const durationH = sleepEventDurationHours(event);
	if (durationH === null) return false;
	return isNap(event.timestamp, durationH, tz);
}

function sleepEventDurationHours(event: RawSleepEventLike): number | null {
	const seconds = event.data?.sleepDuration;
	if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
		return seconds / 3600;
	}
	const endSec = sleepEventEnddateSec(event);
	if (endSec !== null) {
		const spanH = (endSec * 1000 - event.timestamp.getTime()) / 3_600_000;
		return spanH > 0 ? spanH : null;
	}
	return null;
}

/** Map rå 'sleep'-events → netter/naps. Events uten brukbar varighet droppes. */
export function toSleepNights(events: RawSleepEventLike[], tz = OSLO_TZ): SleepNight[] {
	const nights: SleepNight[] = [];
	for (const event of events) {
		const durationH = sleepEventDurationHours(event);
		if (durationH === null) continue;
		const endSec = sleepEventEnddateSec(event);
		nights.push({
			start: event.timestamp,
			end: endSec !== null ? new Date(endSec * 1000) : null,
			durationH: Math.round(durationH * 100) / 100,
			isNap: isNapSleepEvent(event, tz)
		});
	}
	return nights;
}

/**
 * Minutter på en «middag-til-middag»-akse (12:00 = 0, 23:30 = 690, 00:30 = 750).
 * Gjør leggetider rundt midnatt sammenlignbare og medianberegning meningsfull.
 */
export function noonAxisMinutes(date: Date, tz = OSLO_TZ): number {
	const { hour, minute } = localHourMinute(date, tz);
	return (hour * 60 + minute - 720 + 1440) % 1440;
}

/** 'HH:MM' → minutter på middag-aksen. Null ved ugyldig format. */
export function parseTimeToNoonAxis(time: string | undefined | null): number | null {
	if (!time) return null;
	const m = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 23 || minute > 59) return null;
	return (hour * 60 + minute - 720 + 1440) % 1440;
}

/**
 * 'HH:MM' → Date på dagens dato i gitt tidssone (for retroaktiv nap-registrering
 * «hvilte rundt 14»). Null ved ugyldig format.
 */
export function todayAtLocalTime(time: string, now = new Date(), tz = OSLO_TZ): Date | null {
	const m = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 23 || minute > 59) return null;

	// Start fra ønsket klokkeslett som UTC på dagens lokale dato, korriger med observert avvik
	const localDate = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
	const candidate = new Date(
		`${localDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
	);
	const got = localHourMinute(candidate, tz);
	let diffMin = hour * 60 + minute - (got.hour * 60 + got.minute);
	if (diffMin > 720) diffMin -= 1440;
	if (diffMin < -720) diffMin += 1440;
	return new Date(candidate.getTime() + diffMin * 60_000);
}

/** Minutter på middag-aksen → 'HH:MM'. */
export function noonAxisToHHMM(minutes: number): string {
	const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
	const ofDay = (normalized + 720) % 1440;
	const h = Math.floor(ofDay / 60);
	const m = ofDay % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median leggetid (middag-akse-minutter) for ekte netter. */
export function medianBedtimeMinutes(nights: SleepNight[], tz = OSLO_TZ): number | null {
	return median(nights.filter((n) => !n.isNap).map((n) => noonAxisMinutes(n.start, tz)));
}

/** Median oppvåkning (middag-akse-minutter) for ekte netter med kjent slutt. */
export function medianWakeMinutes(nights: SleepNight[], tz = OSLO_TZ): number | null {
	return median(
		nights
			.filter((n) => !n.isNap && n.end !== null)
			.map((n) => noonAxisMinutes(n.end as Date, tz))
	);
}

/** En nap koblet mot natten før — råstoff for «søvnunderskudd → nap»-speiling. */
export interface NapWithPriorNight {
	start: Date;
	durationMinutes: number;
	/** Søvntimer natten før nappen, null når ingen natt finnes innen 24t før */
	priorNightHours: number | null;
}

/**
 * Koble hver nap mot den siste ekte natten som sluttet før nappen startet
 * (innen 24 timer). Ren funksjon — grunnlaget for powernap-signalet.
 */
export function pairNapsWithPriorNights(nights: SleepNight[]): NapWithPriorNight[] {
	const realNights = nights
		.filter((n) => !n.isNap)
		.sort((a, b) => a.start.getTime() - b.start.getTime());
	const naps = nights.filter((n) => n.isNap).sort((a, b) => a.start.getTime() - b.start.getTime());

	return naps.map((nap) => {
		let prior: SleepNight | null = null;
		for (const night of realNights) {
			const nightEnd = night.end ?? new Date(night.start.getTime() + night.durationH * 3_600_000);
			if (nightEnd.getTime() <= nap.start.getTime()) {
				if (nap.start.getTime() - nightEnd.getTime() <= 24 * 3_600_000) prior = night;
			} else {
				break;
			}
		}
		return {
			start: nap.start,
			durationMinutes: Math.round(nap.durationH * 60),
			priorNightHours: prior ? Math.round(prior.durationH * 10) / 10 : null
		};
	});
}

/* ── Evaluering ─────────────────────────────────────────── */

/** Serialiserbar målevaluering for visning (TargetZoneBar på Mål-fanen). */
export interface SleepGoalEval {
	kind: SleepGoalKind;
	/** Nåverdi: timer (duration) eller middag-akse-minutter (bedtime/waketime). Null uten data. */
	value: number | null;
	/** Menneskelesbar nåverdi («7,2t» / «23:12» / «2») */
	currentLabel: string | null;
	/** Menneskelesbar målformulering («minst 7,5t/natt» / «23:00 ± 30 min» / «maks 2/uke») */
	targetLabel: string;
	targetMin: number | null;
	targetMax: number | null;
	domainMin: number;
	domainMax: number;
	mode: 'at_least' | 'at_most' | 'range';
	withinTarget: boolean | null;
	/** Antall ekte netter i grunnlaget */
	nightCount: number;
	/** Antall powernaps i vinduet */
	napCount: number;
}

function formatHours(h: number): string {
	return `${(Math.round(h * 10) / 10).toString().replace('.', ',')}t`;
}

/** Evaluer et søvnmål mot netter fra siste ~7 døgn. Ren funksjon. */
export function evaluateSleepGoal(goal: SleepGoal, nights: SleepNight[], tz = OSLO_TZ): SleepGoalEval {
	const realNights = nights.filter((n) => !n.isNap);
	const napCount = nights.length - realNights.length;

	if (goal.kind === 'nap') {
		const max = goal.maxPerWeek ?? 2;
		return {
			kind: 'nap',
			value: napCount,
			currentLabel: `${napCount}`,
			targetLabel: `maks ${max}/uke`,
			targetMin: null,
			targetMax: max,
			domainMin: 0,
			domainMax: Math.max(max + 3, napCount + 1),
			mode: 'at_most',
			withinTarget: napCount <= max,
			nightCount: realNights.length,
			napCount
		};
	}

	if (goal.kind === 'duration') {
		const target = goal.targetHours ?? 8;
		const avg =
			realNights.length > 0
				? realNights.reduce((s, n) => s + n.durationH, 0) / realNights.length
				: null;
		return {
			kind: 'duration',
			value: avg === null ? null : Math.round(avg * 100) / 100,
			currentLabel: avg === null ? null : formatHours(avg),
			targetLabel: `minst ${formatHours(target)}/natt`,
			targetMin: target,
			targetMax: null,
			domainMin: 4,
			domainMax: 10,
			mode: 'at_least',
			withinTarget: avg === null ? null : avg >= target,
			nightCount: realNights.length,
			napCount
		};
	}

	const targetCenter = parseTimeToNoonAxis(goal.targetTime);
	const tolerance = goal.toleranceMinutes ?? SLEEP_GOAL_DEFAULT_TOLERANCE_MIN;
	const value = goal.kind === 'bedtime' ? medianBedtimeMinutes(nights, tz) : medianWakeMinutes(nights, tz);
	const targetMin = targetCenter === null ? null : targetCenter - tolerance;
	const targetMax = targetCenter === null ? null : targetCenter + tolerance;

	// Domene: målsonen ± 90 min, utvidet så nåverdien alltid er synlig
	const anchor = targetCenter ?? value ?? 660;
	let domainMin = (targetMin ?? anchor) - 90;
	let domainMax = (targetMax ?? anchor) + 90;
	if (value !== null) {
		domainMin = Math.min(domainMin, value - 30);
		domainMax = Math.max(domainMax, value + 30);
	}

	return {
		kind: goal.kind,
		value,
		currentLabel: value === null ? null : noonAxisToHHMM(value),
		targetLabel:
			targetCenter === null
				? 'mål mangler tidspunkt'
				: `${noonAxisToHHMM(targetCenter)} ± ${tolerance} min`,
		targetMin,
		targetMax,
		domainMin,
		domainMax,
		mode: 'range',
		withinTarget:
			value === null || targetMin === null || targetMax === null
				? null
				: value >= targetMin && value <= targetMax,
		nightCount: realNights.length,
		napCount
	};
}

/* ── Metadata & titler ──────────────────────────────────── */

/** Les og valider goals.metadata.sleepGoal. Null når raden ikke er et søvnmål. */
export function readSleepGoalMetadata(metadata: unknown): SleepGoal | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const sg = (metadata as Record<string, unknown>).sleepGoal;
	if (!sg || typeof sg !== 'object') return null;
	const g = sg as Record<string, unknown>;
	if (g.kind !== 'duration' && g.kind !== 'bedtime' && g.kind !== 'waketime' && g.kind !== 'nap') return null;
	if (g.kind === 'duration') {
		if (typeof g.targetHours !== 'number' || !Number.isFinite(g.targetHours)) return null;
		return { kind: 'duration', targetHours: g.targetHours };
	}
	if (g.kind === 'nap') {
		if (typeof g.maxPerWeek !== 'number' || !Number.isFinite(g.maxPerWeek) || g.maxPerWeek < 0) return null;
		return { kind: 'nap', maxPerWeek: g.maxPerWeek };
	}
	if (typeof g.targetTime !== 'string' || parseTimeToNoonAxis(g.targetTime) === null) return null;
	return {
		kind: g.kind,
		targetTime: g.targetTime,
		toleranceMinutes:
			typeof g.toleranceMinutes === 'number' && Number.isFinite(g.toleranceMinutes)
				? g.toleranceMinutes
				: undefined
	};
}

export function defaultSleepGoalTitle(goal: SleepGoal): string {
	if (goal.kind === 'duration') {
		return `Søvn over ${formatHours(goal.targetHours ?? 8)}/natt`;
	}
	if (goal.kind === 'nap') return `Maks ${goal.maxPerWeek ?? 2} powernaps/uke`;
	if (goal.kind === 'bedtime') return `Leggetid rundt ${goal.targetTime}`;
	return `Våken rundt ${goal.targetTime}`;
}
