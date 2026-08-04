/**
 * Feltlogikken for dagsmålene: grenser, validering og advarselen om andelene.
 *
 * Tre inngangsdører skriver de samme fem tallene — `PUT /api/helse/ernaering/mal`,
 * kortet på Ernæring-flaten og chat-verktøyet `manage_nutrition_targets`. Grensene og
 * meldingene bor derfor her. Duplisert ville chatten kunnet «lagre» et mål som
 * endepunktet avviser, eller motsatt: flaten sier 400 mens chatten sier ferdig.
 */

/** Feltnavnene i `metricSettings.nutrition`. */
export const TARGET_FIELDS = [
	'kcalTarget',
	'proteinTarget',
	'proteinPct',
	'carbsPct',
	'fatPct'
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

/**
 * Gyldige spenn.
 *
 * Vide med vilje: dette er ikke helsefaglige anbefalinger, bare et filter mot
 * skrivefeil. 260 kcal er en tastefeil for 2 600; 2 600 g protein er det også.
 */
export const TARGET_LIMITS: Record<TargetField, [number, number]> = {
	kcalTarget: [800, 6000],
	proteinTarget: [30, 400],
	proteinPct: [5, 60],
	carbsPct: [5, 80],
	fatPct: [5, 70]
};

export const TARGET_LABELS: Record<TargetField, string> = {
	kcalTarget: 'Kalorimål',
	proteinTarget: 'Proteinmål',
	proteinPct: 'Proteinandel',
	carbsPct: 'Karboandel',
	fatPct: 'Fettandel'
};

/**
 * Validerer ett felt. Returnerer feilmeldingen, eller null når verdien er god.
 *
 * `null` som verdi er lovlig og betyr «fjern målet» — et tomt felt er et gyldig
 * valg, og å tvinge brukeren til å ha et kaloribudsjett ville vært vår mening, ikke
 * deres.
 */
export function validateTargetField(field: TargetField, value: unknown): string | null {
	if (value === null) return null;
	const [min, max] = TARGET_LIMITS[field];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return `${TARGET_LABELS[field]} må være et tall.`;
	}
	if (value < min || value > max) {
		return `${TARGET_LABELS[field]} må være mellom ${min} og ${max}.`;
	}
	return null;
}

/** Nedre og øvre grense for summen av de tre andelene før vi sier fra. */
export const PCT_SUM_MIN = 90;
export const PCT_SUM_MAX = 110;

/**
 * Advarselen når makroandelene ikke går opp.
 *
 * **Ikke en feil.** Andelene trenger ikke summere til 100 — de er tre uavhengige mål,
 * og man kan sette bare protein. Men summerer de til 60 eller 140, er de umulige å
 * nå samtidig, og da er tausheten verre enn en setning. Null når det ikke er noe å si.
 */
export function macroPctWarning(targets: {
	proteinPct?: number | null;
	carbsPct?: number | null;
	fatPct?: number | null;
}): string | null {
	const parts = [targets.proteinPct, targets.carbsPct, targets.fatPct].filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
	);
	// Under tre andeler er summen meningsløs: har man satt bare protein, er de to
	// andre ikke «0 %», de er usatte.
	if (parts.length < 3) return null;

	const sum = parts.reduce((a, b) => a + b, 0);
	if (sum >= PCT_SUM_MIN && sum <= PCT_SUM_MAX) return null;
	return `Andelene summerer til ${Math.round(sum)} %. De trenger ikke treffe 100 presis, men så langt unna gjør målene umulige å nå samtidig.`;
}

/**
 * Et vanlig utgangspunkt for makrofordelingen.
 *
 * 30/40/30 er ikke en sannhet, men et brukbart sted å starte for den som trener og
 * vil holde vekta — og et forslag er bedre enn tre tomme felt man ikke vet hva man
 * skal fylle med. Brukeren kan endre hvert tall etterpå.
 */
export const DEFAULT_MACRO_SPLIT = { proteinPct: 30, carbsPct: 40, fatPct: 30 } as const;
