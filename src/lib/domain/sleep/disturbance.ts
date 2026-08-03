/**
 * Søvnforstyrrelser: selvrapportert «fikk ikke sove» og «våknet og fikk ikke
 * sove igjen».
 *
 * Dette er *ikke* søvn, og derfor ikke `dataType: 'sleep'`. En natt der du lå
 * våken i to timer har ingen varighet å måle — den har en hendelse. Å presse
 * den inn som en sleep-event med `sleepDuration: 0` ville forgiftet
 * nattsnittet, som er nøyaktig det tallet man vil se når man sover dårlig.
 *
 * Withings fanger `wakeupDuration`, men bare når man har på klokka, og den ser
 * ikke forskjell på «våknet og sov igjen med en gang» og «lå våken til fem».
 * Det skillet er hele poenget her.
 */

export const SLEEP_DISTURBANCE_KINDS = ['innsovning', 'oppvaakning'] as const;

export type SleepDisturbanceKind = (typeof SLEEP_DISTURBANCE_KINDS)[number];

export interface SleepDisturbanceMeta {
	kind: SleepDisturbanceKind;
	/** Kort knappetekst. */
	label: string;
	/** Setningen i loggen. */
	description: string;
	emoji: string;
}

export const SLEEP_DISTURBANCES: SleepDisturbanceMeta[] = [
	{
		kind: 'innsovning',
		label: 'Fikk ikke sove',
		description: 'Fikk ikke sove ved leggetid',
		emoji: '🌙'
	},
	{
		kind: 'oppvaakning',
		label: 'Våknet',
		description: 'Våknet og fikk ikke sove igjen',
		emoji: '👁️'
	}
];

const BY_KIND = new Map(SLEEP_DISTURBANCES.map((d) => [d.kind, d]));

export function disturbanceMeta(kind: SleepDisturbanceKind): SleepDisturbanceMeta {
	return BY_KIND.get(kind) ?? SLEEP_DISTURBANCES[0];
}

export function isSleepDisturbanceKind(value: unknown): value is SleepDisturbanceKind {
	return typeof value === 'string' && (SLEEP_DISTURBANCE_KINDS as readonly string[]).includes(value);
}

/** Rimelig øvre grense for «lå våken i N minutter». Over dette er det en natt uten søvn. */
export const MAX_AWAKE_MINUTES = 600;

/**
 * Fra hvilken Oslo-time et tidspunkt regnes som kveld, og dermed hører til
 * natta som ender neste dag.
 */
const EVENING_FROM_HOUR = 18;

function osloParts(timestamp: string | Date): { year: number; month: number; day: number; hour: number } | null {
	const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
	if (Number.isNaN(date.getTime())) return null;
	const formatted = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Oslo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hour12: false
	}).format(date);
	// sv-SE gir «2026-08-03 23» — ISO-lignende, så oppdelingen er trivielt trygg.
	const [datePart, hourPart] = formatted.split(' ');
	const [year, month, day] = datePart.split('-').map(Number);
	const hour = Number(hourPart) % 24;
	if (![year, month, day, hour].every(Number.isFinite)) return null;
	return { year, month, day, hour };
}

/**
 * Natta en forstyrrelse hører til, som ISO-dato.
 *
 * Nøkkelen er datoen du *våkner*, ikke datoen du la deg. Det er konvensjonen
 * `buildSleepNightSeries` alt bruker (`night.end ?? night.start`), og
 * forstyrrelsene må ligge på samme nøkkel for å kunne stilles ved siden av
 * nattlengden.
 *
 * Så: «fikk ikke sove» kl. 23:30 den 3. og «våknet» kl. 03:00 den 4. hører
 * begge til natta `2026-08-04`.
 */
export function nightKeyForTime(timestamp: string | Date): string | null {
	const parts = osloParts(timestamp);
	if (!parts) return null;

	const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
	// Kveld → natta ender i morgen. Ellers våknet du i dag.
	const shifted = parts.hour >= EVENING_FROM_HOUR ? asUtc + 86_400_000 : asUtc;
	return new Date(shifted).toISOString().slice(0, 10);
}

export interface LoggedDisturbance {
	id: string;
	timestamp: string;
	kind: SleepDisturbanceKind;
	/** Minutter våken, når brukeren oppgav det. */
	awakeMinutes: number | null;
	note: string | null;
	/** 'manual' = registrert selv, 'withings' = utledet av målt søvn. */
	source?: 'manual' | 'withings';
}

export interface DisturbanceNight {
	/** ISO-dato for morgenen natta ender. */
	nightKey: string;
	entries: LoggedDisturbance[];
	innsovning: number;
	oppvaakning: number;
	/** Sum av oppgitte minutter. Null når ingen av dem oppgav noe. */
	awakeMinutes: number | null;
}

/**
 * Grupperer forstyrrelser per natt, nyeste natt først.
 *
 * `awakeMinutes` er null — ikke 0 — når ingen oppgav minutter. Forskjellen
 * betyr noe: 0 minutter våken er ikke det samme som «vet ikke».
 */
export function groupDisturbancesByNight(entries: LoggedDisturbance[]): DisturbanceNight[] {
	const byNight = new Map<string, LoggedDisturbance[]>();
	for (const entry of entries) {
		const key = nightKeyForTime(entry.timestamp);
		if (!key) continue;
		const list = byNight.get(key);
		if (list) list.push(entry);
		else byNight.set(key, [entry]);
	}

	return [...byNight.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.map(([nightKey, list]) => {
			const sorted = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
			const withMinutes = sorted.filter((e) => e.awakeMinutes != null);
			return {
				nightKey,
				entries: sorted,
				innsovning: sorted.filter((e) => e.kind === 'innsovning').length,
				oppvaakning: sorted.filter((e) => e.kind === 'oppvaakning').length,
				awakeMinutes:
					withMinutes.length > 0
						? withMinutes.reduce((sum, e) => sum + (e.awakeMinutes ?? 0), 0)
						: null
			};
		});
}

function nb(value: number): string {
	return value.toLocaleString('nb-NO');
}

/** «2 netter med urolig søvn siste uke, 95 min våken.» */
export function describeDisturbanceWindow(nights: DisturbanceNight[], windowLabel: string): string | null {
	if (nights.length === 0) return null;
	const minutes = nights.reduce((sum, n) => sum + (n.awakeMinutes ?? 0), 0);
	const nightWord = nights.length === 1 ? 'natt' : 'netter';
	const base = `${nights.length} ${nightWord} med urolig søvn ${windowLabel}`;
	return minutes > 0 ? `${base}, ${nb(minutes)} min våken.` : `${base}.`;
}


/* ── Forstyrrelser utledet fra Withings-målt søvn ─────────── */

/**
 * Terskler for når en målt natt regnes som urolig.
 *
 * 30 minutter er den vanlige kliniske grensa både for innsovningstid og for
 * våkentid gjennom natta. Under det er det normal søvn, ikke en forstyrrelse —
 * alle bruker noen minutter på å sovne.
 */
export const LATENCY_THRESHOLD_MINUTES = 30;
export const WASO_THRESHOLD_MINUTES = 30;

export interface MeasuredNight {
	/** ISO-tidspunkt for når søvnen startet. */
	start: string;
	/** Sekunder brukt på å sovne (`sleep_latency`). */
	sleepLatencySeconds?: number | null;
	/** Sekunder våken i løpet av natta (`waso`). */
	wasoSeconds?: number | null;
}

function minutesFrom(seconds: number | null | undefined): number | null {
	if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
	return Math.round(seconds / 60);
}

/**
 * Gjør en målt natt om til forstyrrelser, hvis den var urolig nok.
 *
 * Withings måler dette selv når man ikke husker å logge — men det motsatte
 * gjelder også: enheten kan mene du sov mens du lå våken og tenkte. Derfor
 * erstatter dette ikke den manuelle loggen, det utfyller den.
 *
 * Id-en er avledet av tidspunktet, ikke tilfeldig: den samme natta skal gi den
 * samme id-en ved hver lasting, ellers ville `{#each}`-nøkler i lista endret seg
 * på hver render.
 */
export function deriveDisturbancesFromNight(night: MeasuredNight): LoggedDisturbance[] {
	const derived: LoggedDisturbance[] = [];
	const latency = minutesFrom(night.sleepLatencySeconds);
	const waso = minutesFrom(night.wasoSeconds);

	if (latency !== null && latency >= LATENCY_THRESHOLD_MINUTES) {
		derived.push({
			id: `withings-innsovning-${night.start}`,
			timestamp: night.start,
			kind: 'innsovning',
			awakeMinutes: latency,
			note: null,
			source: 'withings'
		});
	}

	if (waso !== null && waso >= WASO_THRESHOLD_MINUTES) {
		derived.push({
			id: `withings-oppvaakning-${night.start}`,
			timestamp: night.start,
			kind: 'oppvaakning',
			awakeMinutes: waso,
			note: null,
			source: 'withings'
		});
	}

	return derived;
}

/**
 * Slår sammen manuelle registreringer med målte netter.
 *
 * **Manuell logging vinner for en natt der den finnes.** Har du sagt at du ikke
 * fikk sove, er det svaret — også om Sleep Analyzer mener du sov fint. Enheten
 * måler bevegelse og puls, ikke opplevelsen, og opplevelsen er det man handler på.
 *
 * Målte netter fyller derfor bare hullene: netter du ikke logget.
 */
export function mergeDisturbances(
	manual: LoggedDisturbance[],
	measured: MeasuredNight[]
): LoggedDisturbance[] {
	const manualNights = new Set(
		manual.map((entry) => nightKeyForTime(entry.timestamp)).filter((key): key is string => key !== null)
	);

	const fromDevice = measured
		.flatMap(deriveDisturbancesFromNight)
		.filter((entry) => {
			const key = nightKeyForTime(entry.timestamp);
			return key !== null && !manualNights.has(key);
		});

	return [
		...manual.map((entry) => ({ ...entry, source: entry.source ?? ('manual' as const) })),
		...fromDevice
	];
}
