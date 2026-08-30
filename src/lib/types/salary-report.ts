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

/**
 * Månedsgjennomgangen: de fire spørsmålene brukeren valgte, i den rekkefølgen han valgte dem.
 * Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 6.
 *
 * Spørsmål 3 dekkes av `goalProgress`, som alt finnes.
 */
export interface MonthReview {
	/** 1. Bærer måneden som kommer? `carries: null` = vet ikke, IKKE nei. */
	monthAhead: {
		carries: boolean | null;
		margin: number | null;
		reason: string;
	};
	/** 2. Hva var uvanlig? Bare avvikene, målt mot kategoriens EGEN normal. */
	unusual: Array<{
		category: string;
		label: string;
		emoji: string;
		current: number;
		normal: number;
		delta: number;
		direction: 'over' | 'under';
		reason: string;
	}>;
	/** 4. Én ting å gjøre noe med. `action: null` er et gyldig svar. */
	oneThing: {
		action: { kind: string; amountKr: number; text: string } | null;
		reason: string;
	};
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
	/** Fase 6. Valgfri så en gammel klient ikke knekker på en ny nøkkel. */
	review?: MonthReview;
}

