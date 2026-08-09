/**
 * Hvilke Oslo-dager Resonans allerede har data for.
 *
 * Svarer på det ene spørsmålet Ekko ikke kan svare på selv: «av det som ligger i
 * Apple Health, hva er *nytt* for Resonans?». Appen kan telle sin egen historikk,
 * men ikke vår — og uten den halvdelen blir en importknapp et sjansespill.
 *
 * ## Hvorfor dagen, og ikke raden
 *
 * Vektimporten hopper over hele Oslo-dager som allerede har en veiing fra en annen
 * kilde (se `healthkit-weight.ts`), så dagen er enheten svaret må gis i for at det
 * skal stemme med hva importen faktisk gjør. For økter er dagen en *tilnærming* —
 * dedupliseringen der klynger på to timer per sportsfamilie — og flaten som viser
 * tallet skal si det. En dag med én økt i Resonans og to i Helse ser dekket ut her.
 */

import { osloDayKey } from '$lib/domain/oslo-time';

/** Datatypene Ekko kan spørre om. Bare verdier som finnes som `data_type` hos oss. */
export const COVERAGE_TYPES = ['weight', 'workout', 'sleep'] as const;

export type CoverageType = (typeof COVERAGE_TYPES)[number];

export function isCoverageType(value: string): value is CoverageType {
	return (COVERAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Typene der dagen er en tilnærming framfor den regelen importen bruker.
 *
 * Står her framfor i en kommentar på flata, slik at teksten brukeren ser og
 * sannheten om tallet ikke kan gå fra hverandre.
 */
export const APPROXIMATE_TYPES: Partial<Record<CoverageType, string>> = {
	workout:
		'Økter dedupliseres på klynger innenfor to timer per sportsfamilie, ikke på dag. En dag som har én økt hos oss og to i Helse ser dekket ut her.',
	sleep:
		'Netter nøkles på datoen du våkner, og en natt kan bestå av flere segmenter. Dagstallet er derfor omtrentlig.'
};

export interface TypeCoverage {
	/** Antall Oslo-dager med minst én rad. */
	totalDays: number;
	earliest: string | null;
	latest: string | null;
	/** Dager per kalenderår, så et hull er synlig uten å lese hele lista. */
	byYear: Record<string, number>;
	/** Dagene selv, sortert stigende. Det Ekko trekker fra sin egen historikk. */
	days: string[];
	/** Satt når dagen er en tilnærming for denne typen — se `APPROXIMATE_TYPES`. */
	approximation?: string;
}

/**
 * Rå tidsstempler → dekning per Oslo-dag.
 *
 * Radene trenger ikke være sortert eller unike; funksjonen bøtter selv.
 */
export function buildCoverage(
	rows: ReadonlyArray<{ timestamp: Date }>,
	type?: CoverageType
): TypeCoverage {
	const days = new Set<string>();
	for (const row of rows) {
		days.add(osloDayKey(row.timestamp));
	}

	const sorted = [...days].sort();
	const byYear: Record<string, number> = {};
	for (const day of sorted) {
		const year = day.slice(0, 4);
		byYear[year] = (byYear[year] ?? 0) + 1;
	}

	const coverage: TypeCoverage = {
		totalDays: sorted.length,
		earliest: sorted[0] ?? null,
		latest: sorted.at(-1) ?? null,
		byYear,
		days: sorted
	};

	const approximation = type ? APPROXIMATE_TYPES[type] : undefined;
	if (approximation) coverage.approximation = approximation;

	return coverage;
}

/**
 * Leser `types`-parameteren. Tom eller manglende betyr alle.
 *
 * Ukjente navn **avvises** framfor å ignoreres: en skrivefeil som stille gir tom
 * dekning ville sett ut som «Resonans har ingenting», og det er nøyaktig den
 * konklusjonen dette endepunktet finnes for å gjøre etterprøvbar.
 */
export function parseCoverageTypes(
	raw: string | null
): { types: CoverageType[]; unknown: string[] } {
	if (!raw || raw.trim() === '') return { types: [...COVERAGE_TYPES], unknown: [] };

	const requested = raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

	const types: CoverageType[] = [];
	const unknown: string[] = [];
	for (const name of requested) {
		if (isCoverageType(name)) {
			if (!types.includes(name)) types.push(name);
		} else if (!unknown.includes(name)) {
			unknown.push(name);
		}
	}
	return { types, unknown };
}
