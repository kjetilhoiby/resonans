/**
 * Hvilepuls og makspuls — grunnlaget under HRR.
 *
 * Heart rate reserve (`maxHr − restHr`) er bærende for tre ting: TRIMP-skåringen
 * i `effort-service`, sonefordelingen i `computeHrZoneDistribution`, og
 * %VO2max-proxyen i `vdotFromPaceAndHr`. Feil her forplanter seg overalt.
 *
 * ## Hvorfor prioritering og ikke pooling
 *
 * `getEffortBaseline` la historisk *all* `hr_min` i én bøtte og tok medianen.
 * Men `hr_min` betyr tre helt ulike ting avhengig av hvor hendelsen kommer fra:
 *
 * | Kilde | `hr_min` er | Hvilepuls? |
 * |---|---|---|
 * | økt (`workout`) | lavest puls UNDER trening | nei, typisk 90–120 |
 * | dag (`activity`) | lavest puls over døgnet | nesten |
 * | søvn (`sleep`) | lavest puls om natta | ja, best |
 *
 * Medianen over den blandede bøtta er ikke hvilepuls. Verre: da søvn-`hr_min`
 * ble hentet inn i august 2026, endret sammensetningen seg — og dermed
 * effort-skåringen — uten at noe i koden sa fra.
 *
 * ## Hvorfor punktpuls ikke er øverst
 *
 * Vektas punktpuls (Withings type 11) tas STÅENDE, rett etter at man er opp.
 * Den ligger typisk 5–15 slag over ekte hvilepuls. Til gjengjeld er den daglig og
 * pålitelig — man veier seg de fleste morgener, mens søvndata krever klokka på.
 * Derfor: søvn først, punktpuls som utfylling.
 */

export type RestingHrSource = 'sleep_min' | 'scale_spot' | 'daily_min' | 'sleep_avg' | 'default';

export interface RestingHrCandidate {
	value: number;
	source: Exclude<RestingHrSource, 'default'>;
}

export const DEFAULT_REST_HR = 60;
export const DEFAULT_MAX_HR = 190;

/** Under dette antallet observasjoner faller vi videre til neste kilde. */
export const MIN_SAMPLES = 3;

/**
 * Plausible intervaller per kilde. En sovende puls over 90 er ikke hvile, og en
 * stående måling ligger naturlig høyere enn en liggende.
 */
const RANGES: Record<Exclude<RestingHrSource, 'default'>, [number, number]> = {
	sleep_min: [30, 90],
	scale_spot: [35, 110],
	daily_min: [30, 100],
	sleep_avg: [35, 85]
};

/** Rekkefølgen kildene foretrekkes i. Første med nok observasjoner vinner. */
const PRIORITY: Array<Exclude<RestingHrSource, 'default'>> = [
	'sleep_min',
	'scale_spot',
	'daily_min',
	'sleep_avg'
];

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface RestingHrResult {
	restHr: number;
	source: RestingHrSource;
	samples: number;
}

/**
 * Hvilepuls fra den beste tilgjengelige kilden.
 *
 * Medianen tas *innenfor* den valgte kilden, aldri på tvers — å blande en
 * sovepuls med et minimum fra en treningsøkt gir et tall som ikke er noen av dem.
 */
export function resolveRestingHr(candidates: RestingHrCandidate[]): RestingHrResult {
	for (const source of PRIORITY) {
		const [min, max] = RANGES[source];
		const values = candidates
			.filter((c) => c.source === source)
			.map((c) => c.value)
			.filter((v) => Number.isFinite(v) && v > min && v < max);

		if (values.length >= MIN_SAMPLES) {
			return { restHr: Math.round(median(values)), source, samples: values.length };
		}
	}

	return { restHr: DEFAULT_REST_HR, source: 'default', samples: 0 };
}

export type MaxHrSource = 'manual' | 'observed' | 'avg_proxy' | 'default';

export interface MaxHrResult {
	maxHr: number;
	source: MaxHrSource;
	samples: number;
}

/** Utenfor dette er en oppgitt makspuls ikke troverdig. */
export const MAX_HR_MIN = 140;
export const MAX_HR_MAX = 220;

/**
 * Andelen høyeste observasjoner som forkastes som artefakter.
 *
 * `Math.max(...)` var den gamle regelen, og maksimum av et støyende sett er
 * systematisk for høyt — én pulsspike satte makspulsen for 30 dager, og en for høy
 * makspuls gir for lav VDOT og for lave soner. Vi tar derfor ~90-persentilen når
 * det finnes nok observasjoner.
 */
const OUTLIER_FRACTION = 0.1;

export interface MaxHrInput {
	/** Brukerens egen verdi fra `themes.metricSettings.maxHr.goal`. Vinner alltid. */
	manual?: number | null;
	/** Maksverdier fra økter (`hr_max`, `maxHeartRate`). */
	observedMaxes: number[];
	/**
	 * Snittpuls fra økter. Svak siste utvei: snittpulsen i en økt er langt fra
	 * maks, så dette er et gulv forkledd som et estimat. Beholdt fordi noe er
	 * bedre enn default 190 for en bruker uten maksdata.
	 */
	workoutAverages?: number[];
}

export function resolveMaxHr(input: MaxHrInput): MaxHrResult {
	const manual = input.manual;
	if (typeof manual === 'number' && manual >= MAX_HR_MIN && manual <= MAX_HR_MAX) {
		return { maxHr: Math.round(manual), source: 'manual', samples: 0 };
	}

	const observed = input.observedMaxes.filter((v) => Number.isFinite(v) && v > 100 && v < 230);
	if (observed.length > 0) {
		const sorted = [...observed].sort((a, b) => b - a);
		// Med få observasjoner er persentilen meningsløs; da er maks det vi har.
		// Fra fem og opp forkastes ALLTID minst den høyeste — det er den som er
		// en pulsspike. `Math.floor(n * 0.1)` alene når ikke 1 før n = 10.
		const index =
			sorted.length >= 5
				? Math.min(sorted.length - 1, Math.max(1, Math.floor(sorted.length * OUTLIER_FRACTION)))
				: 0;
		return { maxHr: Math.round(sorted[index]), source: 'observed', samples: sorted.length };
	}

	const averages = (input.workoutAverages ?? []).filter((v) => Number.isFinite(v) && v > 100 && v < 220);
	if (averages.length > 0) {
		return {
			maxHr: Math.round(Math.max(...averages) * 1.05),
			source: 'avg_proxy',
			samples: averages.length
		};
	}

	return { maxHr: DEFAULT_MAX_HR, source: 'default', samples: 0 };
}

/** Minste avstand mellom hvile og maks, så HRR-brøken ikke kollapser. */
export const MIN_HR_SPREAD = 60;

export interface HeartRateBaseline {
	restHr: number;
	maxHr: number;
	/** `maxHr − restHr` — heart rate reserve. */
	hrr: number;
	restHrSource: RestingHrSource;
	maxHrSource: MaxHrSource;
	/** Sant når begge sider kommer fra brukerens data, ikke fra defaults. */
	derived: boolean;
}

/**
 * Setter sammen de to sidene og garanterer en brukbar reserve.
 *
 * Spredningsvakten fantes før også: uten den kunne en for lav makspuls og en for
 * høy hvilepuls gi en HRR nær null, og da eksploderer TRIMP-brøken.
 */
export function buildHeartRateBaseline(
	resting: RestingHrResult,
	max: MaxHrResult
): HeartRateBaseline {
	const restHr = resting.restHr;
	let maxHr = max.maxHr;
	if (maxHr - restHr < MIN_HR_SPREAD) maxHr = restHr + MIN_HR_SPREAD;

	return {
		restHr,
		maxHr,
		hrr: maxHr - restHr,
		restHrSource: resting.source,
		maxHrSource: max.source,
		derived: resting.source !== 'default' && max.source !== 'default'
	};
}
