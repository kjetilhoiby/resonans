import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createGoal } from '$lib/server/goals';
import { readLatestWeight } from '$lib/server/goal-progress';
import { horizonForYear, type LongTermGoal } from '$lib/flows/livsintervju';
import type { MetricId } from '$lib/domain/metric-catalog';

/**
 * Opprettelse av målbare langtidsmål knyttet til retningen (visjonene).
 * Brukes av både livsintervjuets speil-steg og den manuelle knappen på
 * Retning-fanen. Deterministisk metrikk-mapping for de støttede målene
 * (vekt, 5/10 km-tid, hvilepuls, belastning, fett-/muskelmasse, sparing);
 * alt annet går via createGoals vanlige klassifisering.
 */

interface ResolvedMetric {
	metricId?: MetricId;
	targetValue?: number;
	unit?: string;
	startValue?: number;
	categoryName: string;
}

async function resolveLongTermMetric(userId: string, goal: LongTermGoal): Promise<ResolvedMetric> {
	const text = `${goal.title} ${goal.unit ?? ''}`.toLowerCase();

	// Kroppssammensetning sjekkes FØR vekt — «muskelmasse 38 kg» skal ikke bli vektmål
	if (/muskel/.test(text) && typeof goal.value === 'number') {
		return { metricId: 'muscle_mass', targetValue: Math.round(goal.value * 10) / 10, unit: 'kg', categoryName: 'Helse' };
	}
	if (/fettmasse|fettprosent|\bfett\b/.test(text) && typeof goal.value === 'number') {
		return { metricId: 'fat_mass', targetValue: Math.round(goal.value * 10) / 10, unit: 'kg', categoryName: 'Helse' };
	}

	// Hvilepuls: slag/min, lavere er bedre
	if (/hvilepuls|puls/.test(text) && typeof goal.value === 'number') {
		return { metricId: 'resting_heart_rate', targetValue: Math.round(goal.value), unit: 'slag/min', categoryName: 'Helse' };
	}

	// Treningsbelastning: ukentlig effort-sum
	if (/belastning|effort/.test(text) && typeof goal.value === 'number') {
		return { metricId: 'weekly_effort', targetValue: Math.round(goal.value), unit: 'poeng', categoryName: 'Helse' };
	}

	// Vekt: lagres som weight_change-delta fra siste måling (slik /plan/mal leser det)
	if (/vekt|\bkg\b/.test(text) && typeof goal.value === 'number') {
		const startValue = await readLatestWeight(userId);
		if (startValue !== null) {
			return {
				metricId: 'weight_change',
				targetValue: Math.round((goal.value - startValue) * 10) / 10,
				unit: 'kg',
				startValue,
				categoryName: 'Helse'
			};
		}
		return { categoryName: 'Helse' };
	}

	// 10 km-tid: målverdi i sekunder (parser gir typisk minutter)
	if (/10\s*k|mila/.test(text) && typeof goal.value === 'number') {
		const isMinutes = !goal.unit || /min/.test(goal.unit.toLowerCase());
		return {
			metricId: 'running_10k_time',
			targetValue: isMinutes ? Math.round(goal.value * 60) : Math.round(goal.value),
			unit: 'sek',
			categoryName: 'Helse'
		};
	}

	// 5 km-tid: samme mønster som 10k
	if (/5\s*k|femmern/.test(text) && typeof goal.value === 'number') {
		const isMinutes = !goal.unit || /min/.test(goal.unit.toLowerCase());
		return {
			metricId: 'running_5k_time',
			targetValue: isMinutes ? Math.round(goal.value * 60) : Math.round(goal.value),
			unit: 'sek',
			categoryName: 'Helse'
		};
	}

	// Sparing: månedlig beløp i kroner
	if (/spar/.test(text) && typeof goal.value === 'number') {
		return {
			metricId: 'monthly_savings',
			targetValue: Math.round(goal.value),
			unit: 'kr',
			categoryName: 'Økonomi'
		};
	}

	return { categoryName: 'Retning' };
}

/**
 * Oppretter et langtidsmål med visionHorizon-kobling. Dedup på tittel +
 * horisont (som bursdagsmålene) — returnerer null ved duplikat/tom tittel.
 */
export async function createLongTermGoal(userId: string, goal: LongTermGoal) {
	const title = goal.title?.trim();
	if (!title) return null;

	const visionHorizon = horizonForYear(goal.year);

	const existing = await db.query.goals.findFirst({
		where: and(
			eq(goals.userId, userId),
			sql`${goals.metadata}->>'visionHorizon' = ${visionHorizon}`,
			sql`lower(${goals.title}) = lower(${title})`
		),
		columns: { id: true }
	});
	if (existing) return null;

	const metric = await resolveLongTermMetric(userId, goal);
	const targetDate = goal.year ? `${goal.year}-12-31` : undefined;

	return createGoal({
		userId,
		categoryName: metric.categoryName,
		title,
		description: `Målbart langtidsmål knyttet til retningen (${visionHorizon.replace('vision_', '')}).`,
		targetDate,
		metricId: metric.metricId,
		targetValue: metric.targetValue,
		unit: metric.unit,
		startValue: metric.startValue,
		startDate: new Date().toISOString().slice(0, 10),
		endDate: targetDate,
		visionHorizon
	});
}
