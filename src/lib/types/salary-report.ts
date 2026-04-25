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

export interface SalaryMonthReport {
	currentSalaryDate: string;
	prevSalaryDate: string;
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
}
