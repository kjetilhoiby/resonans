/**
 * Energibalanse: spist mot forbrent.
 *
 * Ernæringsloggeren måler inntaket. Withings' `totalcalories` — hvileforbrenning
 * pluss aktivitet — er den andre siden, og den har vi aldri bedt om før nå.
 * Uten den kan flaten bare vise «2 100 kcal spist», som ikke svarer på
 * spørsmålet man egentlig har.
 *
 * NB: `metrics.calories` og `data.calories` er BARE aktivitetskalorier. De er
 * ikke dagsforbruket, og å bruke dem her ville gitt et voldsomt underskudd
 * hver dag.
 */

export interface EnergyBalanceInput {
	/** Spist i dag, fra ernæringsloggen. */
	intakeKcal: number | null;
	/** Withings `totalcalories`: hvileforbrenning + aktivitet. */
	expenditureKcal: number | null;
	/** Sant når dagen ikke er omme — da er begge tallene delvise. */
	partialDay?: boolean;
}

export interface EnergyBalance {
	intakeKcal: number;
	expenditureKcal: number;
	/** Positivt = overskudd, negativt = underskudd. */
	balanceKcal: number;
	/** Kort setning til flaten. */
	sentence: string;
	/**
	 * Sant når dagen ikke er omme. Da er balansen ikke et resultat, og flaten
	 * skal si det: har du ikke spist middag ennå, er «underskudd» meningsløst.
	 */
	partialDay: boolean;
}

function nb(value: number): string {
	return Math.round(value).toLocaleString('nb-NO');
}

/**
 * Null når én av sidene mangler.
 *
 * Bevisst ikke «anta 0 for den manglende siden»: et underskudd på 2 500 kcal
 * fordi man glemte å logge er ikke et underskudd, og et overskudd fordi Withings
 * ikke har rapportert dagen ennå er ikke et overskudd. Halve tall er verre enn
 * ingen tall her.
 */
export function computeEnergyBalance(input: EnergyBalanceInput): EnergyBalance | null {
	const intake = input.intakeKcal;
	const expenditure = input.expenditureKcal;

	if (typeof intake !== 'number' || intake <= 0) return null;
	if (typeof expenditure !== 'number' || expenditure <= 0) return null;

	const balance = Math.round(intake - expenditure);
	const partialDay = input.partialDay === true;

	const magnitude = nb(Math.abs(balance));
	const direction = balance > 0 ? 'overskudd' : balance < 0 ? 'underskudd' : 'i balanse';
	const sentence =
		balance === 0
			? `${nb(intake)} kcal spist, ${nb(expenditure)} kcal forbrent — i balanse.`
			: `${nb(intake)} kcal spist, ${nb(expenditure)} kcal forbrent — ${magnitude} kcal ${direction}.`;

	return {
		intakeKcal: Math.round(intake),
		expenditureKcal: Math.round(expenditure),
		balanceKcal: balance,
		sentence,
		partialDay
	};
}

/**
 * Omtrentlig vektendring per uke av et daglig kalorioverskudd/-underskudd.
 *
 * 7 700 kcal per kilo fettvev er den vanlige tommelfingerregelen. Den er grov —
 * kroppen justerer forbrenningen, og de første kiloene er i stor grad vann — så
 * dette er en retningsindikator, ikke en prognose. Flaten må si det.
 */
export const KCAL_PER_KG_FAT = 7700;

export function weeklyWeightTrend(dailyBalanceKcal: number): number {
	return Math.round(((dailyBalanceKcal * 7) / KCAL_PER_KG_FAT) * 100) / 100;
}
