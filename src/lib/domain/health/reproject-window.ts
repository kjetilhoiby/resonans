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
 * Taket på SPENNET per kjøring — ikke på hvor langt tilbake i tid vinduet kan
 * ligge, se `until` under.
 *
 * **Begrunnelsen er trackPoints, ikke slett/skriv.** Fram til 6. september 2026
 * sto det at et for stort spenn risikerte å bli avbrutt mellom sletting og
 * skriving; det er ikke lenger sant — `refreshForRange` sletter og skriver per
 * side, avgrenset til nøyaktig det siden bygger opp igjen (se
 * `workout-projection-chunking.ts`). Den grunnen som STÅR er kostnaden:
 * projeksjonen laster pulskurven for hver løpeøkt i vinduet for å regne
 * sone- og intensitetsfelt, og ni år med løping i ett kall ville lastet hvert
 * spor samtidig. Samme grense og samme grunn som reanalyse-endepunktet.
 */
export const MAX_REPROJECT_WEEKS = 26;

export interface ReprojectWindow {
	weeks: number;
	fromDate: Date;
	toDate: Date;
	/** Ble sluttpunktet oppgitt, eller er vinduet «siste N uker fram til nå»? */
	anchoredToNow: boolean;
}

/**
 * Validerer og bygger vinduet. Kaster med en melding som sier hvorfor grensa
 * finnes — et avvist tall uten begrunnelse ser ut som en vilkårlig begrensning.
 *
 * ## `until` — hvorfor vinduet må kunne PEKES bakover
 *
 * Fram til 6. september 2026 var `toDate` alltid `now`, så vinduet kunne bare
 * være «siste N uker». Da er 26 uker samtidig et tak på spennet OG på hvor langt
 * tilbake man i det hele tatt rekker — og et hull eldre enn det er utenfor
 * verktøyets rekkevidde. Det traff konkret: en tidligere utgave av
 * `refreshForRange` slettet rader den ikke bygde opp igjen, og hullet den
 * etterlot i `canonical_workouts` lå januar–mars 2026. Med tak 26 uker rakk
 * reberegningen til 8. mars — én uke for kort, og den ENE knappen som kunne
 * reparert det nådde ikke fram.
 *
 * `until` flytter vinduet, den utvider det ikke: spennet er fortsatt
 * `MAX_REPROJECT_WEEKS`, av hensyn til pulskurvene. Framtida avvises — et vindu
 * som slutter i morgen sletter og bygger opp igjen et tomrom.
 */
export function resolveReprojectWindow(
	weeksInput: unknown,
	now: Date,
	untilInput?: unknown
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
			error: `weeks kan være maks ${MAX_REPROJECT_WEEKS} per kjøring — projeksjonen laster pulskurven for hver løpeøkt i vinduet. Kjør lengre historikk i biter, og bruk until for å flytte vinduet bakover.`
		};
	}

	const hasUntil = untilInput !== undefined && untilInput !== null && untilInput !== '';
	let toDate = new Date(now);
	if (hasUntil) {
		const parsed = new Date(String(untilInput));
		if (!Number.isFinite(parsed.getTime())) {
			return { error: 'until må være en dato på formen YYYY-MM-DD.' };
		}
		if (parsed.getTime() > now.getTime()) {
			return {
				error: 'until kan ikke ligge i framtida — et vindu som slutter etter i dag bygger opp igjen et tomrom.'
			};
		}
		toDate = parsed;
	}

	const fromDate = new Date(toDate);
	fromDate.setUTCDate(fromDate.getUTCDate() - weeks * 7);

	return { window: { weeks, fromDate, toDate, anchoredToNow: !hasUntil } };
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
