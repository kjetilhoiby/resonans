/**
 * Øktanalysen Ekko sender med opplastingen — det terrenget ikke kan fortelle oss selv.
 *
 * Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md` og kontrakten i
 * `docs/ekko-oktanalyse.md`.
 *
 * Arbeidsdelingen mot `workout-terrain.ts` er hele poenget:
 *
 * - **Serveren** kan finne at det ligger en stigning fra km 2,1 til km 2,6.
 * - **Ekko** vet at den heter «Dreperen», at du har løpt den fjorten ganger, og at
 *   medianen din er 2:23. Ekkos egen `RunFeature`-modell sier det rett ut om
 *   strekk: de «finnes i historikken og i hodet», og ingen terrengterskel kan
 *   finne dem. Et strekk MÅ derfor komme herfra.
 *
 * Alt her er **ekstern input** fra en app-binær vi ikke kontrollerer versjonen av,
 * og som kan være eldre enn serveren. Derfor: valider alt, forkast enkeltelementer
 * framfor hele payloaden, og la manglende felt bli `null` framfor gjettede tall.
 * En feltype som ikke finnes skal ikke velte opplastingen av økta — GPX-en er det
 * viktige, analysen er pynt oppå.
 */

/** Hva slags gjenkjennbar strekning dette er. Speiler Ekkos `RunFeature.Kind`. */
export type FeatureKind = 'hill' | 'track' | 'stretch';

export const FEATURE_KINDS: readonly FeatureKind[] = ['hill', 'track', 'stretch'];

/**
 * Brukerens egen historikk på strekningen, slik Ekko har den.
 *
 * Dette er det som gjør et tall til en beskjed: «2:11» sier ingenting, «2:11 mot
 * medianen din på 2:23» sier alt. Medianen framfor snittet fordi én avbrutt
 * gjennomføring ellers ville dratt referansen ned for godt.
 */
export type FeatureHistory = {
	completions: number;
	medianDurationSec: number | null;
	medianAvgHeartRate: number | null;
	bestDurationSec: number | null;
};

export type AnalyzedFeature = {
	kind: FeatureKind;
	name: string;
	/** Endenavn for rettede strekninger — «Østensjøvannet → Ulsrud». */
	startName: string | null;
	endName: string | null;
	/** Sekunder fra øktas start til strekningen begynte. Plasserer den i sporet. */
	startOffsetSec: number | null;
	durationSec: number | null;
	distanceMeters: number | null;
	elevationGainM: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgPaceSecPerKm: number | null;
	history: FeatureHistory | null;
};

export type AnalyzedLap = {
	index: number;
	distanceMeters: number | null;
	durationSec: number | null;
	avgHeartRate: number | null;
	history: FeatureHistory | null;
};

/** Ett bakkedrag fra en strukturert bakkeøkt. Speiler Ekkos `HillRep`. */
export type AnalyzedHillRep = {
	index: number;
	durationSec: number | null;
	distanceMeters: number | null;
	avgHeartRate: number | null;
	peakHeartRate: number | null;
	/** Sekunder i hver sone, alltid lengde 5 (Z1..Z5) når satt. */
	secondsInZone: number[] | null;
};

export type WorkoutAnalysis = {
	version: number;
	features: AnalyzedFeature[];
	laps: AnalyzedLap[];
	hillReps: AnalyzedHillRep[];
};

/**
 * Tak per liste. Payloaden lagres på sensor-eventen og leses inn i en LLM-prompt,
 * så en app med en løpsk løkke skal ikke kunne blåse opp verken raden eller
 * kontekstvinduet. Kappingen logges av kallstedet.
 */
export const MAX_FEATURES = 40;
export const MAX_LAPS = 100;
export const MAX_HILL_REPS = 60;

/** Lengste navn vi lagrer. Et navn er en etikett, ikke et fritekstfelt. */
export const MAX_NAME_LENGTH = 120;

export type ParseResult = {
	analysis: WorkoutAnalysis | null;
	/** Hva som ble forkastet og hvorfor — logges, så en app-feil ikke blir usynlig. */
	warnings: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/** Endelige tall, eller null. Aldri NaN, aldri Infinity, aldri en streng som ble tall. */
function num(value: unknown, options: { min?: number; max?: number } = {}): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	if (options.min !== undefined && value < options.min) return null;
	if (options.max !== undefined && value > options.max) return null;
	return value;
}

function int(value: unknown, options: { min?: number; max?: number } = {}): number | null {
	const n = num(value, options);
	return n === null ? null : Math.round(n);
}

function str(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, MAX_NAME_LENGTH);
}

/** Puls utenfor dette er en sensorfeil, ikke en måling. */
const HR_BOUNDS = { min: 20, max: 250 };

function parseHistory(value: unknown): FeatureHistory | null {
	const raw = asRecord(value);
	if (!raw) return null;
	const completions = int(raw.completions, { min: 0, max: 100_000 });
	if (completions === null) return null;
	return {
		completions,
		medianDurationSec: num(raw.medianDurationSec, { min: 0 }),
		medianAvgHeartRate: int(raw.medianAvgHeartRate, HR_BOUNDS),
		bestDurationSec: num(raw.bestDurationSec, { min: 0 })
	};
}

function parseFeature(value: unknown): AnalyzedFeature | null {
	const raw = asRecord(value);
	if (!raw) return null;

	const kind = typeof raw.kind === 'string' ? raw.kind : null;
	if (kind === null || !FEATURE_KINDS.includes(kind as FeatureKind)) return null;

	// Et navnløst «strekk» er ikke til å skille fra terrenget serveren finner selv.
	const name = str(raw.name);
	if (name === null) return null;

	const distanceMeters = num(raw.distanceMeters, { min: 0 });
	const durationSec = num(raw.durationSec, { min: 0 });

	return {
		kind: kind as FeatureKind,
		name,
		startName: str(raw.startName),
		endName: str(raw.endName),
		startOffsetSec: num(raw.startOffsetSec, { min: 0 }),
		durationSec,
		distanceMeters,
		elevationGainM: num(raw.elevationGainM),
		avgHeartRate: int(raw.avgHeartRate, HR_BOUNDS),
		maxHeartRate: int(raw.maxHeartRate, HR_BOUNDS),
		// Tempoet regnes her framfor å stoles på: to felt som kan motsi hverandre
		// er ett felt for mye, og appen har ingen grunn til å eie regnestykket.
		avgPaceSecPerKm:
			durationSec !== null && distanceMeters !== null && distanceMeters > 20
				? Math.round(durationSec / (distanceMeters / 1000))
				: null,
		history: parseHistory(raw.history)
	};
}

function parseLap(value: unknown, fallbackIndex: number): AnalyzedLap | null {
	const raw = asRecord(value);
	if (!raw) return null;
	return {
		index: int(raw.index, { min: 1, max: 10_000 }) ?? fallbackIndex,
		distanceMeters: num(raw.distanceMeters, { min: 0 }),
		durationSec: num(raw.durationSec, { min: 0 }),
		avgHeartRate: int(raw.avgHeartRate, HR_BOUNDS),
		history: parseHistory(raw.history)
	};
}

function parseHillRep(value: unknown, fallbackIndex: number): AnalyzedHillRep | null {
	const raw = asRecord(value);
	if (!raw) return null;
	const zones = Array.isArray(raw.secondsInZone)
		? raw.secondsInZone.map((v) => num(v, { min: 0 }))
		: null;
	return {
		index: int(raw.index, { min: 1, max: 10_000 }) ?? fallbackIndex,
		durationSec: num(raw.durationSec, { min: 0 }),
		distanceMeters: num(raw.distanceMeters, { min: 0 }),
		avgHeartRate: int(raw.avgHeartRate, HR_BOUNDS),
		peakHeartRate: int(raw.peakHeartRate, HR_BOUNDS),
		// Delvis utfylte soner forkastes: en sonefordeling med hull leses som
		// «null sekunder i Z3», og det er en påstand vi ikke har dekning for.
		secondsInZone:
			zones !== null && zones.length === 5 && zones.every((v) => v !== null)
				? (zones as number[])
				: null
	};
}

/**
 * Tolker `analysis`-feltet fra Ekko-opplastingen.
 *
 * Returnerer `null` for analysen når det ikke er noe brukbart der — kallstedet
 * skal da lagre økta uten analyse, ikke feile.
 */
export function parseWorkoutAnalysis(input: unknown): ParseResult {
	const warnings: string[] = [];

	let raw: unknown = input;
	if (typeof input === 'string') {
		try {
			raw = JSON.parse(input);
		} catch {
			return { analysis: null, warnings: ['analysis: ugyldig JSON, forkastet'] };
		}
	}

	const record = asRecord(raw);
	if (!record) return { analysis: null, warnings: [] };

	const version = int(record.version, { min: 1, max: 1000 }) ?? 1;

	const takeList = <T>(
		value: unknown,
		max: number,
		label: string,
		parse: (item: unknown, index: number) => T | null
	): T[] => {
		if (!Array.isArray(value)) return [];
		if (value.length > max) {
			warnings.push(`${label}: ${value.length} elementer, kappet til ${max}`);
		}
		const out: T[] = [];
		let dropped = 0;
		for (const [i, item] of value.slice(0, max).entries()) {
			const parsed = parse(item, i + 1);
			if (parsed === null) dropped += 1;
			else out.push(parsed);
		}
		if (dropped > 0) warnings.push(`${label}: forkastet ${dropped} ugyldig(e) element(er)`);
		return out;
	};

	const features = takeList(record.features, MAX_FEATURES, 'features', (item) => parseFeature(item));
	const laps = takeList(record.laps, MAX_LAPS, 'laps', (item, i) => parseLap(item, i));
	const hillReps = takeList(record.hillReps, MAX_HILL_REPS, 'hillReps', (item, i) =>
		parseHillRep(item, i)
	);

	if (features.length === 0 && laps.length === 0 && hillReps.length === 0) {
		return { analysis: null, warnings };
	}

	return { analysis: { version, features, laps, hillReps }, warnings };
}
