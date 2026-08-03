/**
 * Kroppssammensetning fra Withings-vekta.
 *
 * ## Feilen denne modulen retter
 *
 * Withings' måletyper: **6 = fettprosent (%)**, **8 = fettmasse (kg)**. Vår
 * parser leste type 6 og lagret den som `data.fatMass`, og `readBodyComposition`
 * returnerte den som `fatMassKg` — som `/plan/mal` bruker som nåverdi for et
 * fettmasse-mål. En person på 82 kg med 22 % fett fikk «22 kg fettmasse» i stedet
 * for 18. Tallet ser plausibelt ut, og det er nettopp derfor det aldri ble
 * oppdaget.
 *
 * Historiske rader har fortsatt prosenten i `fatMass`. Siden vekta ligger på
 * samme rad, kan kilo regnes ut — så gamle målinger blir riktige uten
 * datamigrering.
 */

export interface BodyCompositionInput {
	/** Vekt i kg (type 1). Trengs for å regne kilo fra prosent. */
	weightKg?: number | null;
	/** Type 8 — fettmasse i kg. Den vi egentlig vil ha. */
	fatMassKg?: number | null;
	/** Type 6 — fettprosent. */
	fatRatio?: number | null;
	/**
	 * Legacy `data.fatMass`: historisk lagret type 6, altså en PROSENT tross
	 * navnet. Brukes bare når `fatRatio` mangler.
	 */
	legacyFatMass?: number | null;
	/** Type 76 — muskelmasse i kg. Denne var alltid riktig. */
	muscleMassKg?: number | null;
	/** Type 5 — fettfri masse i kg. */
	fatFreeMassKg?: number | null;
	/** Type 88 — beinmasse i kg. */
	boneMassKg?: number | null;
	/** Type 77 — hydrering i kg. */
	hydrationKg?: number | null;
}

export interface BodyComposition {
	fatMassKg: number | null;
	fatRatio: number | null;
	muscleMassKg: number | null;
	fatFreeMassKg: number | null;
	boneMassKg: number | null;
	hydrationKg: number | null;
	/** Hvordan `fatMassKg` ble bestemt — målt eller regnet fra prosent. */
	fatMassSource: 'measured' | 'derived' | null;
}

function positive(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * En fettprosent er alltid under 100, og over 75 er den ikke menneskelig.
 * Vakten finnes for å skille en prosent fra en kiloverdi i legacy-feltet:
 * er `fatMass` 18, kan det være 18 kg eller 18 %, og vi må velge.
 * Under 75 tolkes den som prosent, som er det den historisk var.
 */
const MAX_PLAUSIBLE_FAT_RATIO = 75;

export function normalizeBodyComposition(input: BodyCompositionInput): BodyComposition {
	const weight = positive(input.weightKg);
	const measuredFatKg = positive(input.fatMassKg);
	const ratio = positive(input.fatRatio) ?? positive(input.legacyFatMass);
	const usableRatio = ratio !== null && ratio < MAX_PLAUSIBLE_FAT_RATIO ? ratio : null;

	let fatMassKg: number | null = measuredFatKg;
	let fatMassSource: BodyComposition['fatMassSource'] = measuredFatKg !== null ? 'measured' : null;

	if (fatMassKg === null && usableRatio !== null && weight !== null) {
		fatMassKg = round1((weight * usableRatio) / 100);
		fatMassSource = 'derived';
	}

	// Fettfri masse kan utledes når den mangler, men bare fra en KILOVERDI —
	// aldri fra prosenten alene, siden vekta da også må finnes.
	let fatFree = positive(input.fatFreeMassKg);
	if (fatFree === null && weight !== null && fatMassKg !== null) {
		const derived = weight - fatMassKg;
		if (derived > 0) fatFree = round1(derived);
	}

	return {
		fatMassKg: fatMassKg === null ? null : round1(fatMassKg),
		fatRatio: usableRatio === null ? null : round1(usableRatio),
		muscleMassKg: positive(input.muscleMassKg) === null ? null : round1(input.muscleMassKg as number),
		fatFreeMassKg: fatFree,
		boneMassKg: positive(input.boneMassKg) === null ? null : round1(input.boneMassKg as number),
		hydrationKg: positive(input.hydrationKg) === null ? null : round1(input.hydrationKg as number),
		fatMassSource
	};
}

export interface CompositionChange {
	weightKg: number;
	fatMassKg: number | null;
	muscleMassKg: number | null;
	/** Andel av vektendringen som er fett. Null når fettmasse mangler i én ende. */
	fatShare: number | null;
	sentence: string;
}

function signed(value: number): string {
	const formatted = Math.abs(value).toFixed(1).replace('.', ',');
	return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

/**
 * Endringen mellom to målinger, formulert.
 *
 * Dette er hele grunnen til at kroppssammensetning er verdt å hente: «ned 1,4 kg»
 * og «ned 1,4 kg, hvorav 0,9 er muskel» er to helt ulike beskjeder, og vekta alene
 * kan ikke skille dem.
 */
export function describeCompositionChange(
	from: { weightKg: number; composition: BodyComposition },
	to: { weightKg: number; composition: BodyComposition }
): CompositionChange | null {
	const weightDelta = round1(to.weightKg - from.weightKg);

	const fatDelta =
		from.composition.fatMassKg !== null && to.composition.fatMassKg !== null
			? round1(to.composition.fatMassKg - from.composition.fatMassKg)
			: null;
	const muscleDelta =
		from.composition.muscleMassKg !== null && to.composition.muscleMassKg !== null
			? round1(to.composition.muscleMassKg - from.composition.muscleMassKg)
			: null;

	if (weightDelta === 0 && fatDelta === null && muscleDelta === null) return null;

	// Andelen regnes på absoluttverdier: gikk vekta ned 1,4 og fettet ned 0,5,
	// er 36 % av nedgangen fett — resten er muskel og vann.
	const fatShare =
		fatDelta !== null && Math.abs(weightDelta) > 0.05
			? Math.round((Math.abs(fatDelta) / Math.abs(weightDelta)) * 100) / 100
			: null;

	let sentence = `${signed(weightDelta)} kg`;
	if (fatDelta !== null && muscleDelta !== null) {
		sentence += ` — ${signed(fatDelta)} kg fett, ${signed(muscleDelta)} kg muskel`;
	} else if (fatDelta !== null) {
		sentence += ` — ${signed(fatDelta)} kg fett`;
	} else if (muscleDelta !== null) {
		sentence += ` — ${signed(muscleDelta)} kg muskel`;
	}

	return { weightKg: weightDelta, fatMassKg: fatDelta, muscleMassKg: muscleDelta, fatShare, sentence };
}
