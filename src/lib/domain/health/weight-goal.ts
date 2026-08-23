/**
 * Tallene bak et `weight_change`-mål: baseline (fraverdi), målvekt (tilverdi) og
 * deltaet som lagres i `goalTrack.targetValue`.
 *
 * Modulen finnes fordi et vektmål har TO tall og lagringsformatet bare bærer ett.
 * `goalTrack.targetValue` er en ENDRING i kg, og endringen er meningsløs uten
 * baselinen den måles fra — så `metadata.startValue` er ikke et ekstra felt, det er
 * halve målet. Alle fire leserne (`/plan/mal`, `/plan/drommer`, `/ukeplan`,
 * ThemeDataTab) hopper over mål uten baseline, og et mål opprettet gjennom chatten
 * hadde den aldri: `create_goal` manglet parameteren i det hele tatt. Målet ble
 * opprettet, sa «Fraverdi 100 kg» i svaret, og landet under «Uten måling».
 * Se `docs/changelog/2026-08-23-vektmal-uten-maaling.md`.
 */

/** Plausibel menneskevekt i kg. Utenfor spennet gjetter vi ikke. */
export const WEIGHT_PLAUSIBLE_MIN_KG = 30;
export const WEIGHT_PLAUSIBLE_MAX_KG = 300;

export type WeightGoalNumbers = {
	/** Baselinen målet måles fra. */
	startWeight: number;
	/** Vekta målet sikter mot. */
	targetWeight: number;
	/** Det som lagres i `goalTrack.targetValue` — endring i kg, negativ ved nedgang. */
	targetDelta: number;
	/** Hvordan råverdien ble lest: som en endring, eller som en målvekt. */
	targetInterpretation: 'delta' | 'absolute';
	/** Om baselinen var oppgitt, eller hentet fra en måling. */
	startSource: 'oppgitt' | 'maalt';
};

function plausibleWeight(value: unknown): number | null {
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	if (n < WEIGHT_PLAUSIBLE_MIN_KG || n > WEIGHT_PLAUSIBLE_MAX_KG) return null;
	return n;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Tolker et vektmåls to tall.
 *
 * `rawTargetValue` leses som en **målvekt** når den er plausibel som kroppsvekt
 * (≥ 30 kg), ellers som et **delta**. Tolkningen er nødvendig fordi språkmodellen
 * tenker absolutt («ned til 95 kg») mens lagringen er relativ, og fordi mål som alt
 * ligger i basen med 95 i delta-feltet ellers sikter mot startvekt + 95 kg. Et
 * bevisst delta på +30 kg eller mer finnes ikke i praksis, så grensa er trygg.
 *
 * Returnerer null når målet ikke KAN måles — ingen baseline (verken oppgitt eller
 * målt) eller ingen målverdi. Da skal flaten si det, ikke vise et gjettet tall.
 */
export function resolveWeightGoalNumbers(input: {
	rawTargetValue: number | null | undefined;
	startValue: number | null | undefined;
	/** Brukes når baselinen mangler: siste måling ved skriving, første måling i vinduet ved lesing. */
	fallbackStartWeight: number | null | undefined;
}): WeightGoalNumbers | null {
	const explicitStart = plausibleWeight(input.startValue);
	const fallbackStart = plausibleWeight(input.fallbackStartWeight);
	const startWeight = explicitStart ?? fallbackStart;
	if (startWeight === null) return null;

	// NB: Number(null) er 0, altså «hold vekta» — en manglende målverdi skal ikke bli
	// et gyldig mål. Nullsjekken må stå før konverteringen.
	if (input.rawTargetValue === null || input.rawTargetValue === undefined) return null;
	const raw = Number(input.rawTargetValue);
	if (!Number.isFinite(raw)) return null;

	const absolute = raw >= WEIGHT_PLAUSIBLE_MIN_KG;
	const targetWeight = round1(absolute ? raw : startWeight + raw);
	const targetDelta = round1(targetWeight - startWeight);

	return {
		startWeight: round1(startWeight),
		targetWeight,
		targetDelta,
		targetInterpretation: absolute ? 'absolute' : 'delta',
		startSource: explicitStart !== null ? 'oppgitt' : 'maalt'
	};
}
