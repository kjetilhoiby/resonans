/**
 * Vinduet en reberegning av effort-skår skal dekke.
 *
 * ## Hvorfor dette finnes
 *
 * `effortScore` er **lagret** i `canonical_workouts`, ikke regnet ved lesing. Endrer
 * man skåringsmodellen — makspulskilden, `MET_CALIBRATION`, en familiefaktor — gjelder
 * den nye modellen bare økter som skrives etterpå. Historikken står på gammel skala.
 *
 * Det gir en feil som ser ut som en helt annen feil: effort-båndet ankres på snittet
 * av de siste fire ukene, hentet fra lagrede rader. Ligger ankeret på gammel skala og
 * denne ukas økter på ny, sammenlignes to ulike måleenheter, og uka ser kunstig lav ut
 * mot et for høyt bånd. Ingenting sier fra — begge tallene ser plausible ut.
 *
 * Derfor er gulvet på vinduet **ankervinduet pluss en margin**, ikke et rundt tall.
 */

/**
 * Ukene ankeret midles over (`DEFAULT_ANCHOR_WEEKS` i `effort-budget.ts`) pluss
 * inneværende uke. Under dette er reberegningen per definisjon ufullstendig: den
 * ville latt minst én uke av ankeret stå på gammel skala.
 */
export const MIN_REPROJECT_WEEKS = 5;

/** Default: dobbelt ankervindu, så også akutt/kronisk (30 dager) blir konsistent. */
export const DEFAULT_REPROJECT_WEEKS = 8;

/**
 * Taket per kjøring. `refreshForRange` sletter og skriver rader på nytt i ett
 * spenn, og et for stort spenn risikerer å bli avbrutt mellom slett og skriv.
 * Lengre historikk kjøres i biter — samme regel som `withings_backfill`.
 */
export const MAX_REPROJECT_WEEKS = 26;

export interface ReprojectWindow {
	weeks: number;
	fromDate: Date;
	toDate: Date;
}

/**
 * Validerer og bygger vinduet. Kaster med en melding som sier hvorfor grensa
 * finnes — et avvist tall uten begrunnelse ser ut som en vilkårlig begrensning.
 */
export function resolveReprojectWindow(
	weeksInput: unknown,
	now: Date
): { window: ReprojectWindow } | { error: string } {
	const weeks =
		weeksInput === undefined || weeksInput === null || weeksInput === ''
			? DEFAULT_REPROJECT_WEEKS
			: Number(weeksInput);

	if (!Number.isFinite(weeks) || !Number.isInteger(weeks)) {
		return { error: 'weeks må være et helt tall.' };
	}
	if (weeks < MIN_REPROJECT_WEEKS) {
		return {
			error: `weeks må være minst ${MIN_REPROJECT_WEEKS} — effort-båndet ankres på snittet av de siste 4 ukene, så et kortere vindu lar ankeret stå på gammel skala.`
		};
	}
	if (weeks > MAX_REPROJECT_WEEKS) {
		return {
			error: `weeks kan være maks ${MAX_REPROJECT_WEEKS} per kjøring. Kjør lengre historikk i biter — reprojeksjonen sletter og skriver rader i ett spenn.`
		};
	}

	const toDate = new Date(now);
	const fromDate = new Date(now);
	fromDate.setUTCDate(fromDate.getUTCDate() - weeks * 7);

	return { window: { weeks, fromDate, toDate } };
}

export interface WeekEffortRow {
	/** Mandag i uka, `YYYY-MM-DD`. */
	weekStart: string;
	effort: number;
	workouts: number;
}

/**
 * Før/etter per uke, med differansen — det er dette som gjør at man kan SE at
 * reberegningen gjorde noe, framfor å stole på at den gjorde det.
 */
export interface ReprojectComparison {
	weekStart: string;
	before: number;
	after: number;
	deltaPct: number | null;
}

export function compareWeeklyEffort(
	before: WeekEffortRow[],
	after: WeekEffortRow[]
): ReprojectComparison[] {
	const beforeByWeek = new Map(before.map((r) => [r.weekStart, r.effort]));
	const afterByWeek = new Map(after.map((r) => [r.weekStart, r.effort]));
	const weeks = [...new Set([...beforeByWeek.keys(), ...afterByWeek.keys()])].sort();

	return weeks.map((weekStart) => {
		const b = round1(beforeByWeek.get(weekStart) ?? 0);
		const a = round1(afterByWeek.get(weekStart) ?? 0);
		// Null framfor 0 % når det ikke fantes noe å sammenligne med — en uke som
		// gikk fra 0 til 40 har ingen prosentvis endring, den har et nytt tall.
		const deltaPct = b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;
		return { weekStart, before: b, after: a, deltaPct };
	});
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
