/**
 * Krydderet på den daglige oversikten — datainnhentingen. Reglene bor rent i
 * `$lib/domain/digest-nugget-rules.ts`.
 *
 * Se `docs/changelog/2026-09-05-krydder-paa-dagsoversikten.md`.
 *
 * Samme arbeidsdeling som `$lib/server/health/weight-nugget.ts`: denne modulen
 * henter, den rene modulen bestemmer. Hver kilde leses med den samme funksjonen
 * flaten bruker — `loadTrainingDashboardData` for ukas budsjett, `loadStreaks`
 * for rekkene, `readWeightDays` for vekthistorikken — slik at pushen ikke kan
 * komme til å si noe annet enn flaten den lenker til. To veier inn til de samme
 * tallene driver fra hverandre, og en push som motsier skjermen er verre enn
 * ingen push.
 */

import { osloDayKey } from '$lib/domain/oslo-time';
import {
	buildDigestPush,
	type DigestPushCopy,
	type DigestStreak,
	type DigestWeek
} from '$lib/domain/digest-nugget-rules';
import { describeAcuteChronic, describeBudgetStanding } from '$lib/domain/health/effort-standing';
import { readWeightDays } from '$lib/server/health/weight-history';
import { getSickState } from '$lib/server/health/sick-log';
import { loadStreaks } from '$lib/server/services/streak-service';
import { loadTrainingDashboardData } from '$lib/server/training-dashboard';

/**
 * Ukas plan og belastning, med motorens egne ord.
 *
 * `evaluateMilestones` utelates med vilje: en nudge-bygger skal ikke skrive til
 * basen. Samme regel som `buildHealthChatContext`.
 */
async function loadWeek(userId: string): Promise<DigestWeek | null> {
	const training = await loadTrainingDashboardData(userId).catch(() => null);
	const budget = training?.states?.budget;
	if (!budget) return null;

	const plan = describeBudgetStanding(
		budget.spentThisWeek,
		budget.bandMin,
		budget.bandMax,
		budget.sick ?? false
	);
	const load = describeAcuteChronic(budget.acuteChronicRatio, budget.restRecommended);

	return {
		planText: plan.text,
		planLabel: plan.label,
		loadText: load?.text ?? null,
		loadLevel: load?.level ?? null
	};
}

/**
 * Bygger tittel og body til dagsoversikten — eller **null**, som betyr «ikke
 * send».
 *
 * Overliggerne sendes INN framfor å hentes her: kalleren har alt slått opp
 * gårsdagens checkliste for å avgjøre om den skal nudge i det hele tatt, og et
 * andre oppslag på den samme raden kunne kommet ut med et annet svar.
 *
 * Hver kilde er `catch`-et hver for seg. En død vektsynk skal koste
 * ukesoppgjøret på vekta, ikke hele varselet — reglene tåler tomme innganger,
 * og det er nettopp derfor de er skrevet med stillhet som gyldig svar.
 */
export async function computeDigestPush(args: {
	userId: string;
	/** Titlene på punktene fra i går som fortsatt står åpne. */
	carryover: readonly string[];
	/** Settes i tester; ellers dagens Oslo-dato. */
	now?: Date;
}): Promise<DigestPushCopy | null> {
	const { userId, carryover } = args;
	const now = args.now ?? new Date();

	const [sickState, streakRows, weightDays, week] = await Promise.all([
		getSickState(userId, now).catch(() => null),
		loadStreaks(userId, { now }).catch(() => []),
		readWeightDays(userId, { now }).catch(() => []),
		loadWeek(userId).catch(() => null)
	]);

	const streaks: DigestStreak[] = streakRows.map(({ definition, state }) => ({
		title: definition.title,
		state
	}));

	return buildDigestPush({
		today: osloDayKey(now),
		/**
		 * Både en ekte periode og det gamle nå-flagget slår varselet av.
		 * `getSickState` slår dem sammen i `active` nettopp fordi spørsmålet «er
		 * jeg syk nå» har ett svar — og for et varsel er det det eneste
		 * spørsmålet som betyr noe. (Streaks bryr seg om hvilke DAGER som var
		 * syke, og der teller flagget ikke; her holder det at brukeren ligger nede
		 * i dag.)
		 */
		sick: sickState?.active ?? false,
		streaks,
		carryover,
		weightDays,
		week
	});
}
