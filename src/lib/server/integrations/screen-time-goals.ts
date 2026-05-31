/**
 * screen-time-goals.ts
 *
 * Ukesmål for skjermtid. Lagres i den eksisterende `goals`-tabellen under
 * `metadata.screenTimeGoal` (ingen skjemaendring, holdt utenfor det generiske
 * metric-catalog-/goal-track-systemet for å være selvinneholdt).
 *
 * Tre typer:
 *  - total:  total skjermtid (snitt/dag eller ukestotal)
 *  - social: «scrolling» = sosiale medier (snitt/dag eller ukestotal)
 *  - window: minutter innenfor et døgnvindu (f.eks. 16–20), snitt/dag
 */

import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { formatScreenTime, type ScreenTimeCategories } from './screen-time';

export type ScreenTimeGoalKind = 'total' | 'social' | 'window';
export type ScreenTimeGoalBasis = 'day_avg' | 'week_total';

export interface ScreenTimeGoal {
	kind: ScreenTimeGoalKind;
	basis: ScreenTimeGoalBasis; // for window: alltid day_avg
	targetMinutes: number;
	fromHour?: number; // window: 0..23
	toHour?: number; // window: 1..24 (eksklusiv)
	windowCategory?: 'total' | 'social'; // window: hva som telles
}

/** Den delen av sensor_aggregates.metrics.screenTime som målene evalueres mot. */
export interface ScreenTimeMetric {
	totalMinutes: number;
	avgPerDayMinutes: number;
	maxDayMinutes: number;
	socialMinutes: number;
	socialAvgPerDayMinutes: number;
	byCategory: ScreenTimeCategories;
	byHour: number[]; // length 24
	socialByHour: number[]; // length 24
	dayCount: number;
	hourlyDayCount: number;
}

export interface ScreenTimeGoalRecord {
	id: string;
	title: string;
	description: string | null;
	goal: ScreenTimeGoal;
}

export interface ScreenTimeGoalEvaluation extends ScreenTimeGoalRecord {
	currentMinutes: number | null;
	targetMinutes: number;
	withinTarget: boolean | null; // lavere er bedre
	pct: number | null; // current/target, 0..>1 (kan overskride 1 = over mål)
	prevMinutes: number | null;
	deltaMinutes: number | null; // current - prev (negativ = bedre)
	basisLabel: string;
}

function sumWindow(byHour: number[] | undefined, fromHour: number, toHour: number): number {
	if (!Array.isArray(byHour)) return 0;
	let sum = 0;
	for (let h = Math.max(0, fromHour); h < Math.min(24, toHour); h++) {
		sum += byHour[h] ?? 0;
	}
	return sum;
}

/** Hent nåverdi for et mål gitt en periodes skjermtidmetrikk. */
export function currentForGoal(goal: ScreenTimeGoal, metric: ScreenTimeMetric | null): number | null {
	if (!metric) return null;
	if (goal.kind === 'total') {
		return goal.basis === 'week_total' ? metric.totalMinutes : metric.avgPerDayMinutes;
	}
	if (goal.kind === 'social') {
		return goal.basis === 'week_total' ? metric.socialMinutes : metric.socialAvgPerDayMinutes;
	}
	// window — snitt per dag innenfor [fromHour, toHour)
	const from = goal.fromHour ?? 0;
	const to = goal.toHour ?? 24;
	const series = goal.windowCategory === 'social' ? metric.socialByHour : metric.byHour;
	const windowSum = sumWindow(series, from, to);
	const days = Math.max(1, metric.hourlyDayCount);
	return Math.round(windowSum / days);
}

export function basisLabel(goal: ScreenTimeGoal): string {
	if (goal.kind === 'window') {
		const from = goal.fromHour ?? 0;
		const to = goal.toHour ?? 24;
		const what = goal.windowCategory === 'social' ? 'scrolling' : 'skjermtid';
		return `${what} kl. ${String(from).padStart(2, '0')}–${String(to).padStart(2, '0')} (snitt/dag)`;
	}
	const what = goal.kind === 'social' ? 'scrolling' : 'skjermtid';
	return goal.basis === 'week_total' ? `${what} totalt/uke` : `${what} snitt/dag`;
}

export function evaluateScreenTimeGoal(
	record: ScreenTimeGoalRecord,
	thisWeek: ScreenTimeMetric | null,
	prevWeek: ScreenTimeMetric | null
): ScreenTimeGoalEvaluation {
	const current = currentForGoal(record.goal, thisWeek);
	const prev = currentForGoal(record.goal, prevWeek);
	const target = record.goal.targetMinutes;
	return {
		...record,
		currentMinutes: current,
		targetMinutes: target,
		withinTarget: current === null ? null : current <= target,
		pct: current === null || target <= 0 ? null : current / target,
		prevMinutes: prev,
		deltaMinutes: current === null || prev === null ? null : current - prev,
		basisLabel: basisLabel(record.goal)
	};
}

/** Kort, menneskelesbar oppsummering (for chat/AI-kontekst). */
export function summarizeGoalEvaluation(e: ScreenTimeGoalEvaluation): string {
	if (e.currentMinutes === null) {
		return `${e.title}: mål ${formatScreenTime(e.targetMinutes)} (${e.basisLabel}) — ingen data ennå.`;
	}
	const status = e.withinTarget ? '✅ innenfor' : '⚠️ over';
	let delta = '';
	if (e.deltaMinutes !== null) {
		const sign = e.deltaMinutes < 0 ? '↓' : e.deltaMinutes > 0 ? '↑' : '→';
		delta = ` (${sign} ${formatScreenTime(Math.abs(e.deltaMinutes))} fra forrige uke)`;
	}
	return `${e.title}: ${formatScreenTime(e.currentMinutes)} av mål ${formatScreenTime(e.targetMinutes)} — ${status}${delta}.`;
}

/* ── Persistens (goals-tabellen) ─────────────────────────── */

function readGoalMetadata(metadata: unknown): ScreenTimeGoal | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const stg = (metadata as Record<string, unknown>).screenTimeGoal;
	if (!stg || typeof stg !== 'object') return null;
	const g = stg as Record<string, unknown>;
	if (g.kind !== 'total' && g.kind !== 'social' && g.kind !== 'window') return null;
	if (typeof g.targetMinutes !== 'number') return null;
	return {
		kind: g.kind,
		basis: g.basis === 'week_total' ? 'week_total' : 'day_avg',
		targetMinutes: g.targetMinutes,
		fromHour: typeof g.fromHour === 'number' ? g.fromHour : undefined,
		toHour: typeof g.toHour === 'number' ? g.toHour : undefined,
		windowCategory: g.windowCategory === 'social' ? 'social' : g.windowCategory === 'total' ? 'total' : undefined
	};
}

export async function listScreenTimeGoals(userId: string): Promise<ScreenTimeGoalRecord[]> {
	const rows = await db.query.goals.findMany({
		where: and(eq(goals.userId, userId), eq(goals.status, 'active'))
	});
	const out: ScreenTimeGoalRecord[] = [];
	for (const row of rows) {
		const goal = readGoalMetadata(row.metadata);
		if (!goal) continue;
		out.push({ id: row.id, title: row.title, description: row.description, goal });
	}
	return out;
}

function defaultTitle(goal: ScreenTimeGoal): string {
	if (goal.kind === 'window') {
		const from = String(goal.fromHour ?? 0).padStart(2, '0');
		const to = String(goal.toHour ?? 24).padStart(2, '0');
		const what = goal.windowCategory === 'social' ? 'Scrolling' : 'Skjermtid';
		return `${what} under ${formatScreenTime(goal.targetMinutes)} kl. ${from}–${to}`;
	}
	const what = goal.kind === 'social' ? 'Scrolling' : 'Skjermtid';
	const per = goal.basis === 'week_total' ? '/uke' : '/dag';
	return `${what} under ${formatScreenTime(goal.targetMinutes)}${per}`;
}

export async function createScreenTimeGoal(
	userId: string,
	goal: ScreenTimeGoal,
	options: { title?: string; description?: string; themeId?: string } = {}
): Promise<ScreenTimeGoalRecord> {
	const [row] = await db
		.insert(goals)
		.values({
			userId,
			themeId: options.themeId ?? null,
			title: options.title?.trim() || defaultTitle(goal),
			description: options.description ?? null,
			status: 'active',
			metadata: { screenTimeGoal: goal, domain: 'health', metricFamily: 'screen_time' }
		})
		.returning();
	return { id: row.id, title: row.title, description: row.description, goal };
}

export async function deleteScreenTimeGoal(userId: string, goalId: string): Promise<boolean> {
	const existing = await db.query.goals.findFirst({
		where: and(eq(goals.id, goalId), eq(goals.userId, userId))
	});
	if (!existing || !readGoalMetadata(existing.metadata)) return false;
	await db
		.update(goals)
		.set({ status: 'archived', updatedAt: new Date() })
		.where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
	return true;
}
