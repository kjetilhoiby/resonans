/**
 * Livviddehistorikk fra Apple Health.
 *
 * `HKQuantityTypeIdentifierWaistCircumference` er en standardtype i HealthKit, så
 * en bruker som har målt livvidde i en annen app kan ha år med historikk på
 * telefonen. Det er den eneste veien inn til de årene: livvidde finnes ikke i
 * Withings' API i det hele tatt.
 *
 * Tolkningen bor her og skrivingen i endepunktet, samme arbeidsdeling som
 * `healthkit-weight.ts`.
 *
 * ## Enhetsfella, som er større her enn for vekt
 *
 * Livvidde er en **lengde**, og HealthKit gir den i den enheten kalleren ber om.
 * `HKUnit.meter()` gir `0.94`, tommer gir `37`, centimeter gir `94`. Alle tre er
 * plausible tall for et program som ikke sjekker.
 *
 * Vi **forkaster** framfor å konvertere. Å gange 0,94 med 100 «for sikkerhets
 * skyld» ville gjort en gjetning til en måling, og — verre — gjort at feilen på
 * appsiden aldri ble rettet. I stedet teller vi hva som så ut som meter og hva som
 * så ut som tommer, og sier det i klartekst tilbake. Samme prinsipp som
 * `fatRatioLooksLikeFraction` i vektimporten.
 */

import { osloDayKey } from '$lib/domain/oslo-time';
import { WAIST_MAX_CM, WAIST_MIN_CM } from './waist';

/** Samme tak som vektimporten. Ekko sender bolker, ikke hele historikken. */
export const MAX_WAIST_SAMPLES_PER_REQUEST = 500;

/** Eldste tidsstempel vi tror på. Samme gulv som vektimporten. */
export const MIN_WAIST_TIMESTAMP = new Date('1990-01-01T00:00:00.000Z');

/** Klokkeslag telefonen kan ligge foran oss uten at det er en feil. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Spennet en verdi i **meter** ville havnet i. 0,94 for et livmål på 94 cm.
 *
 * Grensene er romslige med vilje: hensikten er å kunne si «dette ser ut som
 * meter» i en feilmelding, ikke å konvertere.
 */
const METERS_MIN = 0.3;
const METERS_MAX = 2.5;

/**
 * Spennet en verdi i **tommer** ville havnet i, under vårt cm-gulv.
 *
 * 40 cm er gulvet, og 40 tommer er 102 cm — så tommer over 40 er umulige å skille
 * fra centimeter og slipper gjennom som cm. Det er en kjent, uunngåelig
 * tvetydighet, og grunnen til at kontrakten må si `HKUnit.meterUnit(with: .centi)`.
 */
const INCHES_MIN = 10;

export interface RawHealthKitWaistSample {
	timestamp?: unknown;
	waistCm?: unknown;
	sourceName?: unknown;
	sourceBundleId?: unknown;
	uuid?: unknown;
}

export interface HealthKitWaistSample {
	timestamp: Date;
	/** Oslo-døgnet målingen hører til. */
	day: string;
	data: { waistCm: number };
	metadata: { sourceName?: string; sourceBundleId?: string; healthKitUuid?: string };
}

export interface ParsedHealthKitWaist {
	samples: HealthKitWaistSample[];
	/** Rader forkastet i sin helhet. */
	invalid: number;
	/** Av dem: verdier som ser ut som meter. Den vanligste enhetsfeilen. */
	looksLikeMeters: number;
	/** Av dem: verdier som ser ut som tommer under cm-gulvet. */
	looksLikeInches: number;
	/** Rader med ugyldig eller urimelig tidsstempel. */
	invalidTimestamp: number;
	/** Duplikater innenfor bolken (samme tidsstempel), fjernet før skriving. */
	duplicateTimestamps: number;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function trimmedString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

export function parseHealthKitWaistSamples(
	raw: unknown,
	options: { now?: Date } = {}
): ParsedHealthKitWaist {
	const now = options.now ?? new Date();
	const maxTimestamp = now.getTime() + MAX_CLOCK_SKEW_MS;

	const result: ParsedHealthKitWaist = {
		samples: [],
		invalid: 0,
		looksLikeMeters: 0,
		looksLikeInches: 0,
		invalidTimestamp: 0,
		duplicateTimestamps: 0
	};

	if (!Array.isArray(raw)) return result;

	const seen = new Set<number>();

	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') {
			result.invalid++;
			continue;
		}
		const sample = entry as RawHealthKitWaistSample;

		const time =
			typeof sample.timestamp === 'string' || typeof sample.timestamp === 'number'
				? new Date(sample.timestamp).getTime()
				: NaN;
		if (Number.isNaN(time) || time < MIN_WAIST_TIMESTAMP.getTime() || time > maxTimestamp) {
			result.invalid++;
			result.invalidTimestamp++;
			continue;
		}

		const waist = finiteNumber(sample.waistCm);
		if (waist === null || waist < WAIST_MIN_CM || waist > WAIST_MAX_CM) {
			result.invalid++;
			if (waist !== null && waist >= METERS_MIN && waist <= METERS_MAX) {
				result.looksLikeMeters++;
			} else if (waist !== null && waist >= INCHES_MIN && waist < WAIST_MIN_CM) {
				result.looksLikeInches++;
			}
			continue;
		}

		// Samme tidsstempel to ganger i én bolk: Apple Health samler kopier fra hver
		// app som har skrevet den samme målingen. Første forekomst vinner.
		if (seen.has(time)) {
			result.duplicateTimestamps++;
			continue;
		}
		seen.add(time);

		const timestamp = new Date(time);
		result.samples.push({
			timestamp,
			day: osloDayKey(timestamp),
			data: { waistCm: round1(waist) },
			metadata: {
				sourceName: trimmedString(sample.sourceName),
				sourceBundleId: trimmedString(sample.sourceBundleId),
				healthKitUuid: trimmedString(sample.uuid)
			}
		});
	}

	result.samples.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
	return result;
}

/**
 * Setningene som skal tilbake til Ekko når noe ble forkastet.
 *
 * Enhetsfeilen navngir rettelsen i klartekst. En import som svarer «431 skrevet, 69
 * forkastet» uten å si hvorfor, blir feilsøkt ved gjetning.
 */
export function waistImportWarnings(parsed: ParsedHealthKitWaist): string[] {
	const warnings: string[] = [];

	if (parsed.looksLikeMeters > 0) {
		warnings.push(
			`${parsed.looksLikeMeters} målinger lå mellom ${METERS_MIN} og ${METERS_MAX} og ser ut som METER. ` +
				'Be om HKUnit.meterUnit(with: .centi), ikke HKUnit.meter(). Radene ble forkastet, ikke konvertert.'
		);
	}

	if (parsed.looksLikeInches > 0) {
		warnings.push(
			`${parsed.looksLikeInches} målinger lå mellom ${INCHES_MIN} og ${WAIST_MIN_CM} og ser ut som TOMMER. ` +
				'Be om HKUnit.meterUnit(with: .centi). NB: tommer over 40 kan ikke skilles fra centimeter, ' +
				'så denne advarselen fanger ikke alt — enheten må være riktig på appsiden.'
		);
	}

	const otherInvalid =
		parsed.invalid - parsed.looksLikeMeters - parsed.looksLikeInches - parsed.invalidTimestamp;
	if (otherInvalid > 0) {
		warnings.push(
			`${otherInvalid} målinger hadde en livvidde utenfor ${WAIST_MIN_CM}–${WAIST_MAX_CM} cm og ble forkastet.`
		);
	}

	if (parsed.invalidTimestamp > 0) {
		warnings.push(
			`${parsed.invalidTimestamp} målinger hadde et tidsstempel vi ikke tror på (før 1990 eller mer enn ett døgn fram i tid).`
		);
	}

	if (parsed.duplicateTimestamps > 0) {
		warnings.push(
			`${parsed.duplicateTimestamps} målinger delte tidsstempel med en annen i samme bolk og ble hoppet over.`
		);
	}

	return warnings;
}

/** Eldste og nyeste Oslo-dag i bolken, til svaret. */
export function waistDayRange(
	samples: readonly HealthKitWaistSample[]
): { oldest: string | null; newest: string | null } {
	if (samples.length === 0) return { oldest: null, newest: null };
	return {
		oldest: samples[0].day,
		newest: samples[samples.length - 1].day
	};
}
