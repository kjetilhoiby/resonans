/**
 * Vektmålinger fra Apple Health, sendt av Ekko.
 *
 * ## Hvorfor dette finnes
 *
 * Withings-kontoen begynner 13. oktober 2017, og det er ekte — seks varianter av
 * `getmeas` mot samme tilsagn, inkludert et kall helt uten datofilter, gir samme
 * eldste måling. Health Mate *leser* fra Apple Health og tegner de eldre årene inn
 * i sine egne grafer uten å laste dem opp, så kurven appen viser fra 2013 finnes
 * ikke i noe API-svar. Veien til de årene går gjennom HealthKit på telefonen, og
 * Ekko er det eneste vi har som kan lese den. Se
 * `docs/ekko-healthkit-vekt-backfill.md`.
 *
 * Modulen er ren, slik at valideringen kan testes uten en database — det er
 * nettopp enhetene og grensene som kan gå galt her, ikke skrivingen.
 *
 * ## Fella modulen er bygget rundt
 *
 * `HKUnit.percent()` gir **0,223 for 22,3 %**. Slipper en slik verdi gjennom som
 * `fatRatio`, regner `normalizeBodyComposition` fettmassen til 0,18 kg — et tall
 * som ser ut som en måling og ikke som en feil. Verdier under `MIN_FAT_RATIO`
 * forkastes derfor, og telles for seg (`fatRatioLooksLikeFraction`) så svaret kan
 * si *hvorfor* framfor bare at noe manglet. En import som stille legger inn fire
 * år med feil kroppssammensetning er verre enn en som avviser dem.
 */

import { osloDayKey } from '$lib/domain/oslo-time';

/**
 * Taket per kall. Fire tusen målinger i én payload er ingen tjeneste å be om, og
 * bolker som feiler enkeltvis kan sendes på nytt uten å begynne forfra.
 */
export const MAX_SAMPLES_PER_REQUEST = 500;

/** Menneskelig vekt i kg. Utenfor dette er raden en enhetsfeil, ikke en måling. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 400;

/**
 * Fettprosent. Nedre grense er satt for å fange 0–1-brøken fra
 * `HKUnit.percent()`, ikke fordi 0,9 % er utenkelig hos et menneske — det er det
 * også, men det er brøken vi faktisk forventer å se.
 */
export const MIN_FAT_RATIO = 1;
export const MAX_FAT_RATIO = 75;

/** Fettfri masse i kg. Grensene fanger gram sendt som kilo (76 900). */
export const MIN_FAT_FREE_MASS_KG = 10;
export const MAX_FAT_FREE_MASS_KG = 300;

/**
 * Eldste tidspunkt vi godtar. Apple Health kan bære en håndskrevet måling med
 * feil årstall, og én rad i 1904 strekker x-aksen på vektflaten over et århundre.
 */
export const MIN_TIMESTAMP = new Date('1990-01-01T00:00:00.000Z');

/** Klokkeslag telefonen kan ligge foran oss uten at det er en feil. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Vinduet dedup-oppslaget må dekke, i døgn på hver side av bolkens spenn.
 *
 * Oslo ligger foran UTC, så en måling 00:30 norsk tid har et tidsstempel på
 * UTC-dagen før. Et oppslag klippet nøyaktig til bolkens tidsstempler ville
 * bommet på Withings-raden som deler Oslo-døgn med bolkens ytterpunkter.
 */
const LOOKUP_PADDING_DAYS = 1;

/** Rådata slik den kommer over ledningen. Alt er `unknown` til det er validert. */
export interface RawHealthKitWeightSample {
	timestamp?: unknown;
	weight?: unknown;
	fatRatio?: unknown;
	fatFreeMass?: unknown;
	sourceName?: unknown;
	sourceBundleId?: unknown;
	uuid?: unknown;
}

export interface HealthKitWeightSample {
	timestamp: Date;
	/** Oslo-døgnet målingen hører til. Dedup-nøkkelen mot eksisterende kilder. */
	day: string;
	/**
	 * Feltnavnene er de `WeightEventData` allerede kjenner, så
	 * `toWeightMeasurements` og `normalizeBodyComposition` leser radene uten at
	 * noen leser må endres.
	 */
	data: { weight: number; fatRatio?: number; fatFreeMass?: number };
	metadata: { sourceName?: string; sourceBundleId?: string; healthKitUuid?: string };
}

export interface ParsedHealthKitWeight {
	samples: HealthKitWeightSample[];
	/** Rader forkastet i sin helhet — ugyldig tidsstempel eller vekt. */
	invalid: number;
	/** Rader der vekta holdt, men fettprosenten ble forkastet. */
	droppedFatRatio: number;
	/** Av dem: rader der fettprosenten så ut som en 0–1-brøk. Enhetsfella. */
	fatRatioLooksLikeFraction: number;
	/** Rader der fettfri masse ble forkastet, men vekta holdt. */
	droppedFatFreeMass: number;
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

/**
 * Rå bolk → målinger vi tør skrive.
 *
 * Rader forkastes framfor å repareres: vi kan ikke vite om 0,223 er en brøk eller
 * en person med 0,2 % kroppsfett, og å gange med 100 «for sikkerhets skyld» ville
 * gjort en gjetning til en måling.
 */
export function parseHealthKitWeightSamples(
	raw: unknown,
	options: { now?: Date } = {}
): ParsedHealthKitWeight {
	const now = options.now ?? new Date();
	const maxTimestamp = now.getTime() + MAX_CLOCK_SKEW_MS;

	const result: ParsedHealthKitWeight = {
		samples: [],
		invalid: 0,
		droppedFatRatio: 0,
		fatRatioLooksLikeFraction: 0,
		droppedFatFreeMass: 0,
		duplicateTimestamps: 0
	};

	if (!Array.isArray(raw)) return result;

	// Siste forekomst av et tidsstempel vinner. Basen har en unik indeks på
	// (sensor, datatype, tidsstempel), så to rader med samme tidspunkt kan ikke
	// begge lagres — da er det ærligere å telle differansen enn å la den
	// forsvinne i en konfliktregel.
	const byTimestamp = new Map<number, HealthKitWeightSample>();

	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') {
			result.invalid++;
			continue;
		}
		const sample = entry as RawHealthKitWeightSample;

		const rawTimestamp = sample.timestamp;
		if (typeof rawTimestamp !== 'string' && typeof rawTimestamp !== 'number') {
			result.invalid++;
			continue;
		}
		const timestamp = new Date(rawTimestamp);
		const time = timestamp.getTime();
		if (Number.isNaN(time) || time < MIN_TIMESTAMP.getTime() || time > maxTimestamp) {
			result.invalid++;
			continue;
		}

		const weight = finiteNumber(sample.weight);
		if (weight === null || weight < MIN_WEIGHT_KG || weight > MAX_WEIGHT_KG) {
			result.invalid++;
			continue;
		}

		const data: HealthKitWeightSample['data'] = { weight: round1(weight) };

		const fatRatio = finiteNumber(sample.fatRatio);
		if (fatRatio !== null) {
			if (fatRatio >= MIN_FAT_RATIO && fatRatio <= MAX_FAT_RATIO) {
				data.fatRatio = round1(fatRatio);
			} else {
				result.droppedFatRatio++;
				// 0 er «ikke målt» hos noen kilder; brøken er alt over 0 og under 1 %.
				if (fatRatio > 0 && fatRatio < MIN_FAT_RATIO) result.fatRatioLooksLikeFraction++;
			}
		}

		const fatFreeMass = finiteNumber(sample.fatFreeMass);
		if (fatFreeMass !== null) {
			// Fettfri masse kan ikke overstige vekta. Gjør den det, er enheten feil
			// eller raden hører til en annen måling.
			const plausible =
				fatFreeMass >= MIN_FAT_FREE_MASS_KG &&
				fatFreeMass <= MAX_FAT_FREE_MASS_KG &&
				fatFreeMass <= weight + 0.5;
			if (plausible) {
				data.fatFreeMass = round1(fatFreeMass);
			} else {
				result.droppedFatFreeMass++;
			}
		}

		const metadata: HealthKitWeightSample['metadata'] = {};
		const sourceName = trimmedString(sample.sourceName);
		const sourceBundleId = trimmedString(sample.sourceBundleId);
		const healthKitUuid = trimmedString(sample.uuid);
		if (sourceName) metadata.sourceName = sourceName;
		if (sourceBundleId) metadata.sourceBundleId = sourceBundleId;
		if (healthKitUuid) metadata.healthKitUuid = healthKitUuid;

		if (byTimestamp.has(time)) result.duplicateTimestamps++;
		byTimestamp.set(time, { timestamp, day: osloDayKey(timestamp), data, metadata });
	}

	result.samples = [...byTimestamp.values()].sort(
		(a, b) => a.timestamp.getTime() - b.timestamp.getTime()
	);
	return result;
}

/**
 * Vinduet dedup-oppslaget skal spørre over, eller null for en tom bolk.
 *
 * Padding på et døgn i hver ende: se `LOOKUP_PADDING_DAYS`.
 */
export function existingDayLookupWindow(
	samples: readonly HealthKitWeightSample[]
): { from: Date; to: Date } | null {
	if (samples.length === 0) return null;
	let min = samples[0].timestamp.getTime();
	let max = min;
	for (const sample of samples) {
		const time = sample.timestamp.getTime();
		if (time < min) min = time;
		if (time > max) max = time;
	}
	const padding = LOOKUP_PADDING_DAYS * 24 * 60 * 60 * 1000;
	return { from: new Date(min - padding), to: new Date(max + padding) };
}

export interface DayPartition {
	write: HealthKitWeightSample[];
	skippedExistingDay: number;
}

/**
 * Dagnivå-dedup: en Oslo-dag som allerede har en vektmåling fra en annen sensor
 * hoppes over i sin helhet.
 *
 * Fra oktober 2017 skriver Health Mate sine egne målinger til Apple Health også,
 * så eksporten inneholder de veiingene vi allerede har fra Withings — med
 * tidsstempler som kan avvike noen sekunder. Dedup på eksakt tidsstempel ville
 * sluppet dem gjennom som ekstra rader, og hver dobbeltført dag ville trukket
 * dagsnittet mot den kilden som tilfeldigvis målte oftest. Hele lesestien snitter
 * uansett per dag, så dagen er den ærlige grensa.
 */
export function partitionByBlockedDays(
	samples: readonly HealthKitWeightSample[],
	blockedDays: ReadonlySet<string>
): DayPartition {
	const write: HealthKitWeightSample[] = [];
	let skippedExistingDay = 0;
	for (const sample of samples) {
		if (blockedDays.has(sample.day)) skippedExistingDay++;
		else write.push(sample);
	}
	return { write, skippedExistingDay };
}

/** Spennet i Oslo-døgn for radene som faktisk ble skrevet. */
export function dayRange(
	samples: readonly HealthKitWeightSample[]
): { oldest: string; newest: string } | null {
	if (samples.length === 0) return null;
	let oldest = samples[0].day;
	let newest = samples[0].day;
	for (const sample of samples) {
		if (sample.day < oldest) oldest = sample.day;
		if (sample.day > newest) newest = sample.day;
	}
	return { oldest, newest };
}

/**
 * Advarslene svaret skal bære.
 *
 * Lesetilgang i HealthKit er usynlig for appen — et avslag gir et tomt resultat,
 * akkurat som «ingen data». Klarer vi ikke å si *hvorfor* en bolk ikke ga noe,
 * ser en mislykket import ut som en vellykket. Derfor formuleres tallene som
 * setninger, ikke bare som tellere Ekko må tolke selv.
 */
export function importWarnings(parsed: ParsedHealthKitWeight): string[] {
	const warnings: string[] = [];

	if (parsed.fatRatioLooksLikeFraction > 0) {
		warnings.push(
			`${parsed.fatRatioLooksLikeFraction} målinger hadde fettprosent under ${MIN_FAT_RATIO} — ` +
				`HKUnit.percent() gir 0,223 for 22,3 %, så verdien må ganges med 100. Vekta ble lagret, fettprosenten ikke.`
		);
	}

	const otherDroppedRatio = parsed.droppedFatRatio - parsed.fatRatioLooksLikeFraction;
	if (otherDroppedRatio > 0) {
		warnings.push(
			`${otherDroppedRatio} målinger hadde fettprosent utenfor ${MIN_FAT_RATIO}–${MAX_FAT_RATIO} og ble lagret uten den.`
		);
	}

	if (parsed.droppedFatFreeMass > 0) {
		warnings.push(
			`${parsed.droppedFatFreeMass} målinger hadde fettfri masse utenfor ${MIN_FAT_FREE_MASS_KG}–${MAX_FAT_FREE_MASS_KG} kg ` +
				`eller høyere enn vekta, og ble lagret uten den.`
		);
	}

	if (parsed.duplicateTimestamps > 0) {
		warnings.push(
			`${parsed.duplicateTimestamps} målinger delte tidsstempel med en annen i samme bolk. Siste vant.`
		);
	}

	if (parsed.invalid > 0) {
		warnings.push(
			`${parsed.invalid} målinger manglet gyldig tidsstempel eller hadde vekt utenfor ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg, og ble forkastet.`
		);
	}

	return warnings;
}
