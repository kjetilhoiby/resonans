/**
 * Pulsfall etter innsats (heart rate recovery), og diagnostikken som avgjør om
 * vi i det hele tatt kan regne det.
 *
 * ## Hvorfor øktfiler ikke holder
 *
 * HRR60 er fallet i de 60 sekundene ETTER at du stoppet. En `.gpx`/`.tcx` fra
 * iSmoothRun slutter å skrive når du trykker stopp, så nettopp de sekundene
 * mangler. Trackpoints har puls i ~1,4 sekunders oppløsning på en 45-minutters
 * økt — rikelig — men halen finnes ikke.
 *
 * Løsningen er en pulsserie som er *uavhengig* av økter. Det er det Tempo får
 * fra HealthKit, og det Withings gir via `getintradayactivity`.
 *
 * ## Hvorfor diagnostikken kommer først
 *
 * Tilgang er ikke problemet — samplingsfrekvens er. ScanWatch måler ofte hvert
 * 10. minutt i ro. Faller den tilbake til det rett etter at økta stoppet, er et
 * 60-sekunders fall umulig å regne uansett hvor pen koden er.
 * `summarizeSampling` svarer på det empirisk før noe bygges videre.
 */

export interface HrSample {
	/** ISO-tidspunkt. */
	at: string;
	bpm: number;
}

export interface SamplingSummary {
	count: number;
	/** Første og siste tidspunkt i vinduet. */
	firstAt: string | null;
	lastAt: string | null;
	/** Sekunder mellom påfølgende punkter. */
	medianGapSeconds: number | null;
	minGapSeconds: number | null;
	maxGapSeconds: number | null;
	/**
	 * Sant når oppløsningen holder til HRR60. Under dette er svaret at Withings
	 * intraday ikke er nok, og at HealthKit-veien må vurderes.
	 */
	sufficientForRecovery: boolean;
}

/**
 * Grovest tillatte medianavstand for at et 60-sekunders fall er meningsfullt.
 *
 * 20 sekunder gir tre punkter i vinduet. Grovere enn det, og «fallet etter 60 s»
 * blir i praksis «fallet etter et sted mellom 40 og 80 s», som ikke er
 * sammenlignbart fra økt til økt.
 */
export const MAX_USABLE_GAP_SECONDS = 20;

function sortByTime(samples: HrSample[]): HrSample[] {
	return [...samples]
		.filter((s) => Number.isFinite(new Date(s.at).getTime()) && Number.isFinite(s.bpm) && s.bpm > 0)
		.sort((a, b) => a.at.localeCompare(b.at));
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Punktavstanden i et vindu — svaret på «holder oppløsningen?». */
export function summarizeSampling(samples: HrSample[]): SamplingSummary {
	const sorted = sortByTime(samples);
	if (sorted.length === 0) {
		return {
			count: 0,
			firstAt: null,
			lastAt: null,
			medianGapSeconds: null,
			minGapSeconds: null,
			maxGapSeconds: null,
			sufficientForRecovery: false
		};
	}

	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const delta = (new Date(sorted[i].at).getTime() - new Date(sorted[i - 1].at).getTime()) / 1000;
		if (delta > 0) gaps.push(delta);
	}

	const medianGap = gaps.length > 0 ? median(gaps) : null;

	return {
		count: sorted.length,
		firstAt: sorted[0].at,
		lastAt: sorted[sorted.length - 1].at,
		medianGapSeconds: medianGap === null ? null : Math.round(medianGap),
		minGapSeconds: gaps.length > 0 ? Math.round(Math.min(...gaps)) : null,
		maxGapSeconds: gaps.length > 0 ? Math.round(Math.max(...gaps)) : null,
		sufficientForRecovery: medianGap !== null && medianGap <= MAX_USABLE_GAP_SECONDS
	};
}

export interface HrRecoveryInput {
	samples: HrSample[];
	/** Når innsatsen sluttet — øktas sluttid. */
	effortEndAt: string;
	/** Hvor mange sekunder etter slutt vi måler fallet. Standard 60. */
	windowSeconds?: number;
	/**
	 * Hvor langt fra måltidspunktet et punkt får ligge. Uten toleranse ville et
	 * punkt på 58 eller 63 sekunder blitt forkastet, og da finner man nesten aldri
	 * et treff.
	 */
	toleranceSeconds?: number;
}

export interface HrRecovery {
	/** Puls ved slutt av innsats. */
	endBpm: number;
	/** Puls ved måltidspunktet. */
	recoveredBpm: number;
	/** Fallet i slag. Positivt = pulsen falt, som er det normale. */
	dropBpm: number;
	/** Faktisk antall sekunder etter slutt målingen ble gjort. */
	atSeconds: number;
	band: 'svak' | 'moderat' | 'god';
}

/**
 * Tersklene for HRR60.
 *
 * Under 12 slags fall regnes klinisk som svakt; over 20 som godt. De er grove og
 * aldersuavhengige, i samme ånd som `vo2maxBand` — et fall målt av en klokke
 * fortjener ikke mer presisjon enn det.
 */
export const RECOVERY_WEAK_BELOW = 12;
export const RECOVERY_GOOD_ABOVE = 20;

export function classifyRecovery(dropBpm: number): HrRecovery['band'] {
	if (dropBpm < RECOVERY_WEAK_BELOW) return 'svak';
	if (dropBpm > RECOVERY_GOOD_ABOVE) return 'god';
	return 'moderat';
}

/**
 * Pulsfallet etter en økt.
 *
 * Null når vi mangler et punkt nær slutt eller nær måltidspunktet. Det er en
 * ærlig null: å bruke nærmeste punkt uansett avstand ville gitt «fallet etter 8
 * minutter» presentert som HRR60.
 */
export function computeHrRecovery(input: HrRecoveryInput): HrRecovery | null {
	const windowSeconds = input.windowSeconds ?? 60;
	const tolerance = input.toleranceSeconds ?? 15;
	const endMs = new Date(input.effortEndAt).getTime();
	if (!Number.isFinite(endMs)) return null;

	const sorted = sortByTime(input.samples);
	if (sorted.length < 2) return null;

	const withOffset = sorted.map((s) => ({
		...s,
		offset: (new Date(s.at).getTime() - endMs) / 1000
	}));

	const nearest = (target: number) => {
		let best: (typeof withOffset)[number] | null = null;
		for (const sample of withOffset) {
			const distance = Math.abs(sample.offset - target);
			if (distance > tolerance) continue;
			if (!best || distance < Math.abs(best.offset - target)) best = sample;
		}
		return best;
	};

	const atEnd = nearest(0);
	const atWindow = nearest(windowSeconds);
	if (!atEnd || !atWindow) return null;
	// Samme punkt for begge betyr at serien er for grov til å se et fall.
	if (atEnd.at === atWindow.at) return null;

	const dropBpm = Math.round(atEnd.bpm - atWindow.bpm);

	return {
		endBpm: Math.round(atEnd.bpm),
		recoveredBpm: Math.round(atWindow.bpm),
		dropBpm,
		atSeconds: Math.round(atWindow.offset),
		band: classifyRecovery(dropBpm)
	};
}

/**
 * Withings' intraday-serie → pulspunkter.
 *
 * Svaret er et OBJEKT nøklet på unix-tidsstempel, ikke en array — så
 * `fetchAllWithingsData`, som antar `body.series` er en liste, ville stille
 * droppet alt. Derfor egen parsing.
 */
export function parseIntradayHeartRate(series: unknown): HrSample[] {
	if (!series || typeof series !== 'object') return [];

	const samples: HrSample[] = [];
	for (const [key, value] of Object.entries(series as Record<string, unknown>)) {
		const unix = Number(key);
		if (!Number.isFinite(unix) || unix <= 0) continue;
		const entry = (value ?? {}) as Record<string, unknown>;
		const bpm = entry.heart_rate;
		if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) continue;
		samples.push({ at: new Date(unix * 1000).toISOString(), bpm });
	}

	return sortByTime(samples);
}
