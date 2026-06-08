import type { GoalItem, PaceEstimate } from './types.js';

const METRIC_DEFAULT_UNITS: Record<string, string> = {
	running_distance: 'km',
	weight_change: 'kg',
	sleep_avg_night: 't',
	steps_avg_day: 'skritt',
	active_minutes_avg_day: 'min',
	grocery_spend: 'kr'
};

const WINDOW_LABELS: Record<string, string> = {
	'7d': 'i uka',
	week: 'i uka',
	'30d': 'i måneden',
	month: 'i måneden',
	quarter: 'i kvartalet',
	year: 'i året',
	'365d': 'i året'
};

function parseDateOnly(iso: string | null | undefined): Date | null {
	if (!iso) return null;
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function isFirstDayOfMonth(date: Date): boolean {
	return date.getDate() === 1;
}

function isLastDayOfMonth(date: Date): boolean {
	const next = new Date(date);
	next.setDate(next.getDate() + 1);
	return next.getDate() === 1;
}

function formatShortDateLocal(date: Date): string {
	return date.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
}

function derivePeriodLabel(opts: {
	window: string | null | undefined;
	durationDays: number | null | undefined;
	startDate: string | null | undefined;
	endDate: string | null | undefined;
}): string {
	const start = parseDateOnly(opts.startDate);
	const end = parseDateOnly(opts.endDate);

	if (start && end) {
		const sameYear = start.getFullYear() === end.getFullYear();

		if (isFirstDayOfMonth(start) && isLastDayOfMonth(end) && sameYear) {
			if (start.getMonth() === end.getMonth()) {
				return `i ${start.toLocaleDateString('no-NO', { month: 'long' })}`;
			}
			if (start.getMonth() === 0 && end.getMonth() === 11) {
				return `i ${start.getFullYear()}`;
			}
			const a = start.toLocaleDateString('no-NO', { month: 'long' });
			const b = end.toLocaleDateString('no-NO', { month: 'long' });
			return `${a}–${b} ${start.getFullYear()}`;
		}

		return `${formatShortDateLocal(start)} – ${formatShortDateLocal(end)}`;
	}

	if (opts.window === 'custom') {
		return opts.durationDays ? `over ${opts.durationDays} dager` : '';
	}
	return opts.window ? WINDOW_LABELS[opts.window] ?? '' : '';
}

export function calculateTaskProgress(task: GoalItem['tasks'][number]): number {
	if (!task.targetValue || !task.progress || task.progress.length === 0) {
		return task.progress && task.progress.length > 0 ? 100 : 0;
	}

	const totalValue = task.progress.reduce((sum, entry) => sum + (entry.value || 0), 0);
	return Math.min(Math.round((totalValue / task.targetValue) * 100), 100);
}

export function calculateGoalProgress(goal: GoalItem): number {
	if (goal.tasks.length === 0) return 0;
	const taskProgresses = goal.tasks.map(calculateTaskProgress);
	const avgProgress = taskProgresses.reduce((sum, pct) => sum + pct, 0) / taskProgresses.length;
	return Math.round(avgProgress);
}

export function formatGoalTrack(goal: GoalItem): string | null {
	const track = goal.metadata?.goalTrack;
	if (!track || typeof track.targetValue !== 'number') return null;

	const metricId = goal.metadata?.metricId ?? '';
	const unit = track.unit || METRIC_DEFAULT_UNITS[metricId] || '';
	const valueStr = unit ? `${track.targetValue} ${unit}` : `${track.targetValue}`;

	const periodStr = derivePeriodLabel({
		window: track.window,
		durationDays: track.durationDays,
		startDate: goal.metadata?.startDate,
		endDate: goal.metadata?.endDate
	});

	return periodStr ? `${valueStr} ${periodStr}` : valueStr;
}

export function getIntentBadge(goal: GoalItem):
	| { label: string; tone: 'pending' | 'parsed' | 'failed' }
	| null {
	const status = goal.metadata?.intentStatus;
	if (status === 'pending') return { label: 'Tolkes...', tone: 'pending' };
	if (status === 'parsed') return { label: 'Aktiv sporing', tone: 'parsed' };
	if (status === 'failed') return { label: 'Trenger avklaring', tone: 'failed' };
	return null;
}

export function getIntentEvaluationLabel(goal: GoalItem): string | null {
	const e = goal.metadata?.intentEvaluation;
	if (!e) return null;
	if (typeof e.currentValue !== 'number' || typeof e.targetValue !== 'number') return null;
	if (e.targetValue <= 0) return null;

	const pct = Math.max(0, Math.min(100, Math.round((e.currentValue / e.targetValue) * 100)));
	const metText = e.met ? 'oppnådd' : 'pågår';
	return `${e.currentValue}/${e.targetValue} denne uka (${pct}%) · ${metText}`;
}

export function getIntentFailureReasonLabel(goal: GoalItem): string | null {
	if (goal.metadata?.intentStatus !== 'failed') return null;
	const reason = goal.metadata?.intentError;
	if (!reason) return null;

	const reasonMap: Record<string, string> = {
		empty_text: 'Ingen tekst å tolke.',
		unsupported_activity: 'Støtter foreløpig bare løpemål i denne flyten.',
		unsupported_period_or_threshold: 'Fant ikke tydelig frekvens som "X ganger per uke".',
		invalid_threshold: 'Kunne ikke lese målverdi for antall per uke.',
		unknown: 'Ukjent parse-feil.'
	};

	return reasonMap[reason] ?? `Tolking feilet (${reason}).`;
}

export function formatDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	return new Date(iso).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatMetricValue(value: number): string {
	return `${Math.round(value * 10) / 10}`;
}

export function computePaceEstimate(opts: {
	startDate: string;
	endDate: string;
	startValue: number;
	currentValue: number;
	targetValue: number;
	unit: string;
	formatValue: (v: number) => string;
}): PaceEstimate | null {
	const startMs = new Date(`${opts.startDate}T12:00:00Z`).getTime();
	const endMs = new Date(`${opts.endDate}T12:00:00Z`).getTime();
	const nowMs = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime();
	const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000));
	const daysElapsed = Math.max(0, Math.min(totalDays, Math.round((nowMs - startMs) / 86400000)));
	if (daysElapsed <= 0) return null;

	const totalChange = opts.targetValue - opts.startValue;
	const direction = totalChange === 0 ? 1 : Math.sign(totalChange);

	const expectedAtNow = opts.startValue + (daysElapsed / totalDays) * totalChange;
	const signedDiff = (opts.currentValue - expectedAtNow) * direction;
	const absDiff = Math.abs(signedDiff);

	let diffTone: PaceEstimate['diffTone'];
	let diffLabel: string;
	if (absDiff < 0.5) {
		diffTone = 'neutral';
		diffLabel = 'På skjema';
	} else if (signedDiff > 0) {
		diffTone = 'ahead';
		diffLabel = `${opts.formatValue(absDiff)} ${opts.unit} foran plan`;
	} else {
		diffTone = 'behind';
		diffLabel = `${opts.formatValue(absDiff)} ${opts.unit} bak plan`;
	}

	const ratePerDay = (opts.currentValue - opts.startValue) / daysElapsed;
	const projected = opts.startValue + ratePerDay * totalDays;
	const projectedSignedDiff = (projected - opts.targetValue) * direction;
	const projectedAbsDiff = Math.abs(projected - opts.targetValue);

	let estimateTone: PaceEstimate['estimateTone'];
	let estimateSuffix = '';
	if (projectedAbsDiff < 0.5) {
		estimateTone = 'neutral';
	} else if (projectedSignedDiff > 0) {
		estimateTone = 'ahead';
		estimateSuffix = ` (${opts.formatValue(projectedAbsDiff)} ${opts.unit} over mål)`;
	} else {
		estimateTone = 'behind';
		estimateSuffix = ` (${opts.formatValue(projectedAbsDiff)} ${opts.unit} under mål)`;
	}

	const estimateLabel = `Estimat ved dagens snitt: ~${opts.formatValue(projected)} ${opts.unit}${estimateSuffix}`;

	return { diffLabel, diffTone, estimateLabel, estimateTone };
}
