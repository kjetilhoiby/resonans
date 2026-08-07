/**
 * Daglige energibalanser ut av inntaksloggen — inngangen til `checkAgainstWeight`.
 *
 * Regnestykket lå inline i `nutrition-dashboard.ts`. Da chatten skulle få se
 * vektkontrollen, var alternativet å skrive det på nytt i verktøyet, og et
 * duplisert regnestykke over de samme radene er nøyaktig den forskjellen som ikke
 * oppdages: begge sider ser plausible ut.
 *
 * To detaljer det er lett å miste i en kopi:
 *
 * - **Dager uten forbrukstall droppes**, de blir ikke 0. En dag uten
 *   aktivitetsrad er en dag vi ikke vet noe om, og en 0 der ville gitt et
 *   overskudd på hele inntaket.
 * - **Bare i dag er `partialDay`.** Historiske dager er komplette. Merker man alle
 *   som delvise, faller de ut av `computeEnergyBalance` sitt underskuddsbegrep.
 */

import { computeEnergyBalance } from './energy-balance';
import { groupByDay, summarizeDay, type LoggedEntry, type NutritionTargets } from './day-summary';
import type { DailyBalance } from './weight-reality-check';

export function buildDailyBalances(input: {
	entries: LoggedEntry[];
	targets: NutritionTargets;
	/** Forbruk per dagsnøkkel. Dager som mangler her utelates. */
	expenditureByDate: Record<string, number>;
	/** Dagens Oslo-dato — den ene dagen som fortsatt vokser. */
	today: string;
}): DailyBalance[] {
	const { entries, targets, expenditureByDate, today } = input;

	return groupByDay(entries).flatMap((day) => {
		const expenditureKcal = expenditureByDate[day.date];
		if (typeof expenditureKcal !== 'number') return [];

		const balance = computeEnergyBalance({
			intakeKcal: summarizeDay(day.date, day.entries, targets).totals.kcal,
			expenditureKcal,
			partialDay: day.date === today
		});

		return balance ? [{ date: day.date, balanceKcal: balance.balanceKcal }] : [];
	});
}
