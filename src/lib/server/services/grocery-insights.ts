/**
 * grocery-insights.ts — delt beregning av dagligvareforbruk for uke + baseline.
 * Brukes av economics_grocery_spend_weekly-signalet og mandagsnudgen, slik at
 * de to alltid viser samme tall. Én transaksjonsspørring over hele vinduet
 * (baseline + uke), splittet i JS — queryCanonicalTransactions laster
 * merchant-mappings/overrides/regler per kall, så færre kall er billigere.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { foodSettings } from '$lib/db/schema';
import { queryCanonicalTransactions } from '$lib/server/integrations/categorized-events';

const BASELINE_WEEKS = 4;

export type GroceryWeekSpend = {
	/** Dagligvareforbruk i [weekStart, weekEnd) */
	spend: number;
	/** Snitt per uke over de 4 ukene før weekStart */
	baselineWeeklyAvg: number;
	/** Ukebudsjett fra food_settings, eller null */
	budgetWeekly: number | null;
	/** Antall transaksjoner i uka */
	transactionCount: number;
};

export async function getGroceryWeekSpend(
	userId: string,
	weekStart: Date,
	weekEnd: Date
): Promise<GroceryWeekSpend> {
	const baselineStart = new Date(weekStart.getTime() - BASELINE_WEEKS * 7 * 86400000);

	const [rows, settingsRow] = await Promise.all([
		queryCanonicalTransactions({
			userId,
			from: baselineStart,
			to: weekEnd,
			category: 'dagligvarer',
			spendingOnly: true
		}),
		db.query.foodSettings.findFirst({ where: eq(foodSettings.userId, userId) })
	]);

	let spend = 0;
	let baselineTotal = 0;
	let transactionCount = 0;
	for (const row of rows) {
		const amount = Math.abs(Number(row.amount) || 0);
		const ts = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
		if (ts >= weekStart) {
			spend += amount;
			transactionCount += 1;
		} else {
			baselineTotal += amount;
		}
	}

	return {
		spend,
		baselineWeeklyAvg: baselineTotal / BASELINE_WEEKS,
		budgetWeekly:
			settingsRow?.groceryBudgetWeekly != null ? Number(settingsRow.groceryBudgetWeekly) : null,
		transactionCount
	};
}
