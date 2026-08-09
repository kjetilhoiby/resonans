/**
 * Effort-modellens delte tall: familiene, MET-faktorene og TRIMP-kurven.
 *
 * ## Hvorfor dette ligger i domenelaget
 *
 * Modellen har to stier inn til det samme tallet, og de MÅ møtes:
 *
 * - **TRIMP** (Banister) når økta har brukbar puls: `min × HRR × 0,64 × e^(1,92·HRR)`
 * - **MET** når den ikke har det: `min × familiefaktor × MET_CALIBRATION`
 *
 * Faktorene lå duplisert i `server/services/effort-service.ts` (som skårer øktene)
 * og `server/tracks/effort-budget.ts` (som viser hva en planlagt økt *ville* gitt).
 * To kopier av et kalibreringstall driver fra hverandre, og da lover planleggeren
 * noe annet enn skåringen leverer. `effort-budget.ts` er ren og kan ikke importere
 * `effort-service.ts` (den drar inn DB-en), så tallene hører her — over begge.
 *
 * ## Om kalibreringen
 *
 * `MET_CALIBRATION` er ikke et fritt valgt tall: den er utledet av TRIMP-kurven ved
 * en referanse-intensitet, slik at et løpeminutt koster omtrent det samme uansett
 * hvilken sti det gikk gjennom. Fram til august 2026 lå den hardkodet på 2,5 —
 * som svarer til HRR ≈ 0,82, altså langt hardere enn en rolig økt. Den verdien var
 * i praksis kalibrert mot en **for lav** makspuls (se `heart-rate-baseline.ts`), og
 * arvet dermed feilen inn i alle øktene uten puls.
 */

export type EffortFamily =
	| 'running'
	| 'cycling'
	| 'ebike'
	| 'strength'
	| 'yoga'
	| 'walking'
	| 'hiking'
	| 'swimming'
	| 'other';

export const EFFORT_FAMILIES: EffortFamily[] = [
	'running',
	'cycling',
	'ebike',
	'strength',
	'yoga',
	'walking',
	'hiking',
	'swimming',
	'other'
];

/**
 * MET-faktorer per effort-family, relativt til løping (1,0).
 *
 * Kryssjekk mot `energy-expenditure.ts`, som er bygget uavhengig og bruker
 * (MET − 1) for å trekke fra hvilen man hadde brukt uansett: el-sykkel 4,5 mot
 * løpingens ~10 gir netto 3,5/9 ≈ 0,39. At de to modellene lander på det samme er
 * grunnen til å tro på 0,4.
 */
export const MET_FACTOR_BY_FAMILY: Record<EffortFamily, number> = {
	running: 1.0,
	cycling: 0.85,
	ebike: 0.4,
	strength: 0.7,
	yoga: 0.35,
	walking: 0.3,
	hiking: 0.55,
	swimming: 0.95,
	other: 0.5
};

/** Minste varighet for at en økt teller (sekunder). */
export const MIN_WORKOUT_DURATION_SECONDS = 5 * 60;

/**
 * Banister TRIMP per minutt ved en gitt HRR-andel (herrekoeffisientene).
 *
 * Eksponentiell, og det er hele poenget: feil i HRR forsterkes. Ti slag feil
 * makspuls flytter effort ~20 % — derfor er makspulskilden en større sak enn den
 * ser ut som.
 */
export function trimpPerMinute(hrr: number): number {
	return hrr * 0.64 * Math.exp(1.92 * hrr);
}

/**
 * HRR-nivået MET-stien kalibreres mot: en typisk rolig-til-moderat utholdenhetsøkt.
 *
 * Referansen er oppgitt i HRR framfor som et ferdig tall nettopp fordi det gjør
 * kalibreringen etterprøvbar — og fordi et hardkodet tall stille arver feilen i
 * makspulsen det en gang ble tunet mot.
 */
export const CALIBRATION_REFERENCE_HRR = 0.75;

/**
 * Bringer MET-skår inn på TRIMP-skalaen: et løpeminutt skal koste omtrent det
 * samme enten det ble skåret med puls eller uten.
 *
 * ≈ 2,03 ved referansen over. Endrer du `CALIBRATION_REFERENCE_HRR`, endrer du
 * prisen på ALT uten puls — sykkel, el-sykkel, styrke — i ett jafs.
 */
export const MET_CALIBRATION =
	Math.round((trimpPerMinute(CALIBRATION_REFERENCE_HRR) / MET_FACTOR_BY_FAMILY.running) * 100) / 100;

/**
 * Klassifiser en økt til en effort-family. sportType prioriteres så vi kan skille
 * e-sykkel fra vanlig sykkel selv om begge har sportFamily='cycling' i canonical_workouts.
 */
export function classifyEffortFamily(
	sportType: string | null | undefined,
	sportFamily?: string | null
): EffortFamily {
	const t = (sportType ?? '').trim().toLowerCase();
	const f = (sportFamily ?? '').trim().toLowerCase();

	if (t === 'e_bike' || t.includes('ebik') || t.includes('e-bike')) return 'ebike';
	if (t.includes('running') || t === 'løp' || t === 'run' || t === 'løping') return 'running';
	if (t.includes('cycling') || t === 'sykkel' || t === 'bike') return 'cycling';
	if (t.includes('strength') || t.includes('styrke') || t === 'gym') return 'strength';
	if (t.includes('yoga') || t.includes('pilates') || t === 'mikroyoga') return 'yoga';
	if (t.includes('walking') || t === 'gå' || t === 'gåtur') return 'walking';
	if (t.includes('hiking') || t.includes('fjelltur')) return 'hiking';
	if (t.includes('swimming') || t === 'svømming') return 'swimming';

	// sportFamily-fallback
	if (f === 'running' || f === 'cycling' || f === 'walking' || f === 'swimming') return f;

	return 'other';
}
