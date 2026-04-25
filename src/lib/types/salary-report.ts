export interface GoalProgressItem {
	type: 'track' | 'goal';
	metricId?: string;
	label: string;
	targetValue: number;
	actualValue: number;
	unit: string;
	direction: 'lower_is_better' | 'higher_is_better' | 'towards_target';
	achieved: boolean;
	goalTitle?: string;
	goalDescription?: string | null;
}

/** One AI-seeded observation presented as a step in the wizard */
export interface SalaryInsight {
	id: string;
	title: string;         // e.g. "Totalt forbruk gikk ned i mars"
	emoji: string;
	/** Short numbers/summary line shown below title */
	summary: string;       // e.g. "kr 28 400 — ned 12% vs forrige periode"
	/** Full context sent as system prompt in chat for this step */
	systemPrompt: string;
	/** Initial AI message auto-sent to open the chat */
	seedMessage: string;
	/** Optional: category id this insight is about */
	category?: string;
	/** Whether this is the final free-reflection step */
	isFreeReflection?: boolean;
}

export interface SalaryMonthReport {
	currentSalaryDate: string;
	prevSalaryDate: string | null;
	salaryAmount: number;
	totalSpending: number;
	totalFixed: number;
	totalVariable: number;
	categories: Array<{
		category: string;
		label: string;
		emoji: string;
		amount: number;
		count: number;
		isFixed: boolean;
	}>;
	savingsChanges: Array<{
		accountId: string;
		accountName: string;
		startBalance: number;
		endBalance: number;
		change: number;
	}>;
	goalProgress: GoalProgressItem[];
	previousMonthSpending: number;
	spendingTrend: number;
	insights: SalaryInsight[];
}

