/**
 * Hjerterytmevariasjon (HRV) fra Withings' søvnmåling.
 *
 * ## Hvorfor «siste mot egen baseline», og ikke «beste»
 *
 * VO2max og pulsfall oppsummeres med *beste* observasjon i perioden, fordi begge
 * forutsetter at du presset: en rolig tur gir et lavt tall som ikke betyr noe.
 * HRV er det motsatte. Den måles i søvn, hver natt, uten at du gjør noe — og den
 * svarer på «hvordan står det til nå». Et rekordtall fra i mars sier ingenting om
 * i natt, og «beste HRV siste åtte uker» ville vært et ubrukelig tall.
 *
 * ## Hvorfor absoluttverdien ikke vises alene
 *
 * SDNN varierer enormt mellom folk — 20 ms kan være normalt for én og et
 * varselsignal for en annen. Det finnes ingen meningsfull normtabell å plassere
 * folk i, slik det finnes for VO2max. Det eneste som betyr noe er **avviket fra
 * ditt eget snitt**. Derfor er `baseline` obligatorisk i presentasjonen, og
 * metrikken sier eksplisitt «ukjent» til den har nok netter.
 *
 * ## Hvilket tall
 *
 * `sdnn_1` er Withings' SDNN over ett minutt, levert som en serie gjennom natta.
 * Vi tar medianen over natta, ikke snittet: enkeltminutter med bevegelse eller
 * dårlig sensorfeste gir utslag som drar snittet.
 */

/** Utenfor dette er tallet ikke SDNN i millisekunder. */
export const HRV_MIN_MS = 5;
export const HRV_MAX_MS = 300;

/** Netter som må til før et avvik er verdt å regne på. */
export const MIN_BASELINE_NIGHTS = 7;

/**
 * Hvor stort avvik fra baselinen som regnes som noe.
 *
 * HRV svinger 5–10 % fra natt til natt hos friske folk uten at det betyr noe. 10 %
 * er derfor grovt satt, i samme ånd som `vo2maxBand` og `classifyRecovery` — et
 * tall fra en klokke fortjener ikke mer presisjon.
 */
export const HRV_DEVIATION_PCT = 10;

export interface HrvNight {
	/** Natta HRV-en hører til, som `YYYY-MM-DD`. */
	date: string;
	sdnnMs: number;
	/** Hvor mange minuttmålinger natta bygger på. */
	samples: number;
}

export interface HrvMetric {
	/** Siste natt. Dette er tallet som betyr noe. */
	latest: number;
	latestDate: string;
	/** Netter i vinduet totalt. */
	nights: number;
	/** Median av nettene FØR siste. Null til vi har nok. */
	baseline: number | null;
	baselineNights: number;
	/** Siste natt mot baselinen, i prosent. Null når baselinen mangler. */
	deviationPct: number | null;
	band: 'under' | 'normal' | 'over' | 'ukjent';
}

export function isPlausibleHrv(value: unknown): value is number {
	return (
		typeof value === 'number' && Number.isFinite(value) && value >= HRV_MIN_MS && value <= HRV_MAX_MS
	);
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Én natts SDNN fra Withings' segmentserie.
 *
 * Serien er — som `hr` og som intraday-pulsen — et **objekt nøklet på
 * unix-tidsstempel**, ikke en array. Withings deler dessuten natta i flere
 * segmenter når man er ute av senga, så alle segmentene slås sammen.
 */
export function parseSleepHrvSeries(segments: unknown): { sdnnMs: number; samples: number } | null {
	if (!Array.isArray(segments)) return null;

	const values: number[] = [];
	for (const segment of segments) {
		const series = (segment as Record<string, unknown> | null)?.sdnn_1;
		if (!series || typeof series !== 'object') continue;
		for (const value of Object.values(series as Record<string, unknown>)) {
			if (isPlausibleHrv(value)) values.push(value);
		}
	}

	if (values.length === 0) return null;
	return { sdnnMs: Math.round(median(values) * 10) / 10, samples: values.length };
}

/**
 * Siste natt satt mot ditt eget snitt.
 *
 * `nights` forventes i vilkårlig rekkefølge; de sorteres. Null når ingen netter
 * har brukbar HRV.
 */
export function pickHrvMetric(nights: HrvNight[]): HrvMetric | null {
	const usable = nights.filter((n) => isPlausibleHrv(n.sdnnMs) && /^\d{4}-\d{2}-\d{2}$/.test(n.date));
	if (usable.length === 0) return null;

	// Én rad per natt, siste vinner om samme dato kommer to ganger.
	const byDate = new Map<string, HrvNight>();
	for (const night of usable) byDate.set(night.date, night);
	const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

	const latest = sorted[sorted.length - 1];
	const earlier = sorted.slice(0, -1);

	if (earlier.length < MIN_BASELINE_NIGHTS) {
		return {
			latest: latest.sdnnMs,
			latestDate: latest.date,
			nights: sorted.length,
			baseline: null,
			baselineNights: earlier.length,
			deviationPct: null,
			band: 'ukjent'
		};
	}

	const baseline = Math.round(median(earlier.map((n) => n.sdnnMs)) * 10) / 10;
	const deviationPct = Math.round(((latest.sdnnMs - baseline) / baseline) * 1000) / 10;

	return {
		latest: latest.sdnnMs,
		latestDate: latest.date,
		nights: sorted.length,
		baseline,
		baselineNights: earlier.length,
		deviationPct,
		band:
			deviationPct <= -HRV_DEVIATION_PCT
				? 'under'
				: deviationPct >= HRV_DEVIATION_PCT
					? 'over'
					: 'normal'
	};
}

/** «42,5 ms» med norsk desimaltegn. */
export function formatHrv(value: number): string {
	return `${value.toFixed(1).replace('.', ',')} ms`;
}
