/**
 * Summering av transaksjoner til forbruk per kategori.
 *
 * Bor i domenelaget, ikke ved siden av DB-leseren, slik at reglene kan testes uten å mocke
 * en database — og det er reglene som har tatt feil her, ikke spørringene. Se
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
 */

import { CATEGORIES, type CategoryId } from '$lib/integrations/transaction-categories-client';

/** Minimum en rad må bære for å kunne summeres. Holder modulen fri for DB-typer. */
export type SummarizableTransaction = {
	amount: number;
	description: string;
	category: CategoryId;
	isFixed: boolean;
	isInternalTransfer: boolean;
};

export type CategoryTotal = {
	category: CategoryId;
	label: string;
	emoji: string;
	amount: number;
	count: number;
	isFixed: boolean;
};

export type SpendingSummary = {
	totalSpending: number;
	totalFixed: number;
	totalVariable: number;
	totalIncome: number;
	/** Flyttet mellom egne kontoer i perioden. Ikke en del av `totalSpending`. */
	internalTransferTotal: number;
	categories: CategoryTotal[];
};

/**
 * Nøkkelen `detectRecurring` bygger. Delt herfra fordi kalleren må bygge den samme når den
 * slår opp: to steder som runder ulikt gir et oppslag som aldri treffer, og en stille
 * bommende gjentakelsesdeteksjon ser ut som «ingenting er fast».
 */
export function recurringKeyFor(tx: Pick<SummarizableTransaction, 'description' | 'amount'>): string {
	return `${tx.description.toLowerCase().trim()}|${Math.round(tx.amount / 10) * 10}`;
}

/**
 * **Interne overføringer holdes utenfor forbruket, uansett.** Det var feilen som fikk
 * husholdningens forbruk til å se ut som 132 000 kr/mnd i stedet for ~42 000: 68 % av
 * «forbruket» var penger flyttet mellom egne kontoer. De rapporteres i
 * `internalTransferTotal` framfor å forsvinne, så tallet er synlig og etterprøvbart.
 *
 * Bare den **utgående** siden av en overføring telles i den summen — begge sider ville
 * dobbelt.
 */
export function summarizeSpending(
	transactions: readonly SummarizableTransaction[],
	options: { recurringKeys?: ReadonlySet<string> } = {}
): SpendingSummary {
	const { recurringKeys } = options;
	const categoryMap = new Map<CategoryId, CategoryTotal>();

	let totalSpending = 0;
	let totalFixed = 0;
	let totalVariable = 0;
	let totalIncome = 0;
	let internalTransferTotal = 0;

	for (const tx of transactions) {
		const absAmount = Math.abs(tx.amount);

		if (tx.isInternalTransfer) {
			if (tx.amount < 0) internalTransferTotal += absAmount;
			continue;
		}

		if (tx.amount > 0) {
			totalIncome += absAmount;
			continue;
		}

		const isFixed = tx.isFixed || (recurringKeys?.has(recurringKeyFor(tx)) ?? false);

		totalSpending += absAmount;
		if (isFixed) totalFixed += absAmount;
		else totalVariable += absAmount;

		const catDef = CATEGORIES[tx.category] ?? CATEGORIES['ukategorisert'];
		const existing = categoryMap.get(tx.category);
		if (existing) {
			existing.amount += absAmount;
			existing.count += 1;
			// En kategori er «fast» bare hvis alt i den er det. Ellers ville én fast
			// abonnementsrad gjort hele kategorien fast.
			existing.isFixed = existing.isFixed && isFixed;
		} else {
			categoryMap.set(tx.category, {
				category: tx.category,
				label: catDef.label,
				emoji: catDef.emoji,
				amount: absAmount,
				count: 1,
				isFixed
			});
		}
	}

	return {
		totalSpending,
		totalFixed,
		totalVariable,
		totalIncome,
		internalTransferTotal,
		categories: [...categoryMap.values()].sort((a, b) => b.amount - a.amount)
	};
}
