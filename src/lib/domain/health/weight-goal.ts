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

/** Et tall som kan være en kroppsvekt i kilo, ellers null. */
export function plausibleWeightKg(value: unknown): number | null {
	return plausibleWeight(value);
}

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

/**
 * Målvekta nevnt i en måltittel eller beskrivelse: «Redusere vekt til 95 kg» → 95.
 *
 * Finnes fordi språkmodellen skriver tittelen og måltallet i samme tur, og de kan
 * sprike: prod fikk «Redusere vekt til 95 kg» med −5 i målfeltet, altså et mål som
 * siktet mot 93 kg. Tittelen er det brukeren leser, så den er både en kryssjekk og
 * en siste utvei når måltallet ikke kan være en vekt.
 *
 * Mønsteret er smalt med vilje: bare «til NN kg» (eller kilo). «Ned 5 kg innen jul»
 * treffer ikke — der er 5 en endring, og en parser som gjettet ellers ville laget en
 * målvekt på 5 kg.
 */
export function targetWeightInText(text: string | null | undefined): number | null {
	if (!text) return null;
	const match = /\btil\s*(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)\b/i.exec(text);
	if (!match) return null;
	return plausibleWeight(Number(match[1].replace(',', '.')));
}

/** Hvor mye tekst og måltall kan sprike før det er en selvmotsigelse, i kg. */
export const TARGET_TEXT_TOLERANCE_KG = 0.5;

export type WeightGoalTargetResult =
	| { ok: true; targetWeightKg: number; source: 'oppgitt' | 'tittel' }
	| { ok: false; error: string };

/**
 * Målvekta for et nytt vektmål, validert mot ordene målet er beskrevet med.
 *
 * Kontrakten mot språkmodellen er ABSOLUTT (en målvekt), fordi det er slik brukeren
 * snakker — men modellen sender likevel av og til en endring. Rekkefølgen her er
 * derfor: et tall som KAN være en vekt vinner; kan det ikke, leses målvekta ut av
 * tittelen; spriker de to, avvises hele opprettelsen.
 *
 * Avvisning framfor gjetning når begge finnes og er uenige: et mål som sikter mot et
 * annet tall enn det brukeren sa, er verre enn et mål som ikke ble opprettet — og
 * modellen kan rette seg selv i samme tur.
 */
export function validateWeightGoalTarget(input: {
	title?: string | null;
	description?: string | null;
	targetWeightKg?: number | null;
	targetValue?: number | null;
}): WeightGoalTargetResult {
	const explicit = plausibleWeightKg(input.targetWeightKg) ?? plausibleWeightKg(input.targetValue);
	const fromText = targetWeightInText(`${input.title ?? ''} ${input.description ?? ''}`);

	if (explicit !== null && fromText !== null && Math.abs(explicit - fromText) > TARGET_TEXT_TOLERANCE_KG) {
		return {
			ok: false,
			error: `Målvekten spriker: teksten sier ${fromText} kg, men målverdien er ${explicit} kg. Rett opp det ene og kall verktøyet igjen — et mål som sikter mot et annet tall enn det brukeren sa, er verre enn ingen mål.`
		};
	}

	const target = explicit ?? fromText;
	if (target === null) {
		return {
			ok: false,
			error: `Vektmål krever MÅLVEKTEN i kilo, ikke endringen: send targetWeightKg=95 for «ned til 95 kg» (mottok targetWeightKg=${input.targetWeightKg ?? 'ingen'}, targetValue=${input.targetValue ?? 'ingen'}). Serveren regner endringen selv fra siste veiing.`
		};
	}

	return { ok: true, targetWeightKg: target, source: explicit !== null ? 'oppgitt' : 'tittel' };
}
