export type SaveState = 'idle' | 'saving' | 'saved';

export interface ChecklistItem {
	id: string;
	text: string;
	checked: boolean;
	parentId?: string | null;
}

export interface MonthChecklist {
	id: string;
	title: string;
	emoji: string;
	completedAt: string | null;
	items: ChecklistItem[];
}

export interface MonthGoal {
	id: string;
	title: string;
	goalType:
		| 'running_distance'
		| 'yoga_sessions'
		| 'weight_kg'
		| 'reading_books'
		| 'spending_nok'
		| 'manual_counter';
	trackingMetric:
		| 'running_distance'
		| 'yoga_sessions'
		| 'weight_kg'
		| 'reading_books'
		| 'spending_nok'
		| 'manual_counter';
	target: { value: number; unit: string };
	currentValue: number;
	baselineValue: number | null;
}

export interface WeekInMonth {
	year: number;
	week: string;
	dashedKey: string;
	contextKey: string;
	startDate: string;
	endDate: string;
	daysInMonth: number;
}

export interface WeekChecklist {
	id: string;
	title: string;
	completedAt: string | null;
	items: ChecklistItem[];
}

export const GOAL_TYPE_CONFIG: Record<
	MonthGoal['goalType'],
	{
		emoji: string;
		label: string;
		placeholder: string;
		unitPlaceholder: string;
		tracked: boolean;
	}
> = {
	running_distance: {
		emoji: '\u{1F3C3}',
		label: 'Løping',
		placeholder: 'Løpemål i måneden',
		unitPlaceholder: 'km',
		tracked: true
	},
	yoga_sessions: {
		emoji: '\u{1F9D8}',
		label: 'Yoga',
		placeholder: 'Yogamål i måneden',
		unitPlaceholder: 'økter',
		tracked: true
	},
	weight_kg: {
		emoji: '⚖️',
		label: 'Vekt',
		placeholder: 'Målvekt ved månedsslutt',
		unitPlaceholder: 'kg',
		tracked: true
	},
	reading_books: {
		emoji: '\u{1F4DA}',
		label: 'Boklesing',
		placeholder: 'Bøker i måneden',
		unitPlaceholder: 'bøker',
		tracked: false
	},
	spending_nok: {
		emoji: '\u{1F4B0}',
		label: 'Forbruk',
		placeholder: 'Månedlig forbrukstak',
		unitPlaceholder: 'kr',
		tracked: false
	},
	manual_counter: {
		emoji: '✏️',
		label: 'Annet',
		placeholder: 'Mål du teller manuelt',
		unitPlaceholder: 'ganger',
		tracked: false
	}
} as const;

export function goalTypeEmoji(type: MonthGoal['goalType'] | MonthGoal['trackingMetric']) {
	return GOAL_TYPE_CONFIG[type]?.emoji ?? '\u{1F3AF}';
}

export function isAutoTracked(goal: MonthGoal) {
	return GOAL_TYPE_CONFIG[goal.trackingMetric]?.tracked ?? false;
}

export function goalReached(goal: MonthGoal) {
	if (goal.target.value <= 0) return false;
	if (goal.trackingMetric === 'weight_kg') return goal.currentValue <= goal.target.value;
	return goal.currentValue >= goal.target.value;
}

export function formatGoalProgress(goal: MonthGoal) {
	if (goal.trackingMetric === 'weight_kg') {
		const current = Number.isFinite(goal.currentValue) ? goal.currentValue.toFixed(1) : '-';
		const target = Number.isFinite(goal.target.value) ? goal.target.value.toFixed(1) : '-';
		return `${current} / ${target} ${goal.target.unit || 'kg'}`;
	}
	if (goal.target.value > 0) {
		return `${goal.currentValue} / ${goal.target.value} ${goal.target.unit}`;
	}
	return `${goal.currentValue} ${goal.target.unit}`;
}

export function goalTrackingLabel(goal: MonthGoal) {
	if (goal.trackingMetric === 'running_distance') return 'Oppdateres automatisk fra løpeøkter';
	if (goal.trackingMetric === 'yoga_sessions') return 'Oppdateres automatisk fra yogaøkter';
	if (goal.trackingMetric === 'weight_kg') return 'Oppdateres automatisk fra vektregistreringer';
	if (goal.trackingMetric === 'spending_nok') return 'Klar for kobling til økonomiregistrering';
	if (goal.trackingMetric === 'reading_books') return 'Klar for kobling til leseregistrering';
	return 'Manuell teller';
}

export function formatWeekRange(week: WeekInMonth): string {
	const start = new Date(`${week.startDate}T12:00:00Z`);
	const end = new Date(`${week.endDate}T12:00:00Z`);
	const startDay = start.getUTCDate();
	const endDay = end.getUTCDate();
	const startMonth = new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(start);
	const endMonth = new Intl.DateTimeFormat('nb-NO', { month: 'short' }).format(end);
	if (startMonth === endMonth) return `${startDay}–${endDay}. ${endMonth}`;
	return `${startDay}. ${startMonth} – ${endDay}. ${endMonth}`;
}

export function formatTargetDate(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat('nb-NO', { month: 'short', year: 'numeric' }).format(d);
}
