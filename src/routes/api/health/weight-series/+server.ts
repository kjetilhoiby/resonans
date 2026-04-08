import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { goals, sensorEvents } from '$lib/db/schema';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

type WindowPreset = '7d' | '30d' | '365d' | 'week' | 'month' | 'year';

interface WeightPoint {
	timestamp: string;
	weight: number;
	x: number;
}

function parseDate(value: string | null): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
}

function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function endOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d;
}

function daysBetweenInclusive(start: Date, end: Date): number {
	const a = startOfDay(start).getTime();
	const b = startOfDay(end).getTime();
	return Math.max(1, Math.floor((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

function buildRangeForPreset(preset: WindowPreset, now = new Date()): { start: Date; end: Date; label: string } {
	if (preset === '7d') {
		const end = endOfDay(now);
		const start = startOfDay(addDays(end, -6));
		return { start, end, label: 'Siste 7 dager' };
	}

	if (preset === '30d') {
		const end = endOfDay(now);
		const start = startOfDay(addDays(end, -29));
		return { start, end, label: 'Siste 30 dager' };
	}

	if (preset === '365d') {
		const end = endOfDay(now);
		const start = startOfDay(addDays(end, -364));
		return { start, end, label: 'Siste 365 dager' };
	}

	if (preset === 'week') {
		const d = new Date(now);
		const day = d.getDay();
		const mondayShift = day === 0 ? 6 : day - 1;
		d.setDate(d.getDate() - mondayShift);
		const start = startOfDay(d);
		const end = endOfDay(addDays(start, 6));
		return { start, end, label: 'Inneværende uke' };
	}

	if (preset === 'month') {
		const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
		const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
		return { start, end, label: 'Inneværende måned' };
	}

	const start = startOfDay(new Date(now.getFullYear(), 0, 1));
	const end = endOfDay(new Date(now.getFullYear(), 11, 31));
	return { start, end, label: 'Inneværende år' };
}

function previousMatchingRange(start: Date, end: Date, preset: WindowPreset): { start: Date; end: Date } {
	if (preset === 'week') {
		const prevStart = addDays(start, -7);
		return { start: prevStart, end: addDays(end, -7) };
	}

	if (preset === 'month') {
		const prevStart = startOfDay(new Date(start.getFullYear(), start.getMonth() - 1, 1));
		const prevEnd = endOfDay(new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0));
		return { start: prevStart, end: prevEnd };
	}

	if (preset === 'year') {
		const year = start.getFullYear() - 1;
		return {
			start: startOfDay(new Date(year, 0, 1)),
			end: endOfDay(new Date(year, 11, 31))
		};
	}

	const spanDays = daysBetweenInclusive(start, end);
	const prevEnd = endOfDay(addDays(start, -1));
	const prevStart = startOfDay(addDays(prevEnd, -(spanDays - 1)));
	return { start: prevStart, end: prevEnd };
}

function buildYDomain(values: number[]): { min: number; max: number } {
	if (values.length === 0) return { min: 0, max: 1 };
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = Math.max(0.8, max - min);
	const pad = Math.max(0.25, span * 0.18);
	return {
		min: Number((min - pad).toFixed(2)),
		max: Number((max + pad).toFixed(2))
	};
}

async function loadWeightEvents(userId: string, start: Date, end: Date) {
	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'weight'),
			gte(sensorEvents.timestamp, start),
			lte(sensorEvents.timestamp, end)
		),
		orderBy: [asc(sensorEvents.timestamp)]
	});

	return rows
		.map((row) => {
			const weight = typeof row.data?.weight === 'number' ? row.data.weight : null;
			if (weight == null || !Number.isFinite(weight)) return null;
			return {
				timestamp: row.timestamp,
				weight
			};
		})
		.filter((item): item is { timestamp: Date; weight: number } => item !== null);
}

function normalizePeriodPoints(
	events: Array<{ timestamp: Date; weight: number }>,
	periodStart: Date,
	xMax: number
): WeightPoint[] {
	const startTs = startOfDay(periodStart).getTime();
	return events
		.map((item) => {
			const dayOffset = Math.floor((startOfDay(item.timestamp).getTime() - startTs) / (1000 * 60 * 60 * 24));
			if (dayOffset < 0 || dayOffset > xMax) return null;
			return {
				timestamp: item.timestamp.toISOString(),
				weight: item.weight,
				x: dayOffset
			};
		})
		.filter((item): item is WeightPoint => item !== null);
}

function buildDesiredLine(args: {
	startWeight: number;
	targetWeight: number;
	start: Date;
	end: Date;
	xMax: number;
}): Array<{ x: number; weight: number }> {
	const totalDays = Math.max(1, daysBetweenInclusive(args.start, args.end) - 1);
	const points: Array<{ x: number; weight: number }> = [];
	for (let x = 0; x <= args.xMax; x += 1) {
		const t = Math.min(1, x / totalDays);
		points.push({
			x,
			weight: Number((args.startWeight + (args.targetWeight - args.startWeight) * t).toFixed(3))
		});
	}
	return points;
}

function buildForecast(args: {
	actual: WeightPoint[];
	targetEnd: Date;
	periodStart: Date;
	xMax: number;
}): {
	paceKgPerDay: number | null;
	projectedEndWeight: number | null;
	points: Array<{ x: number; weight: number }>;
} {
	if (args.actual.length < 2) {
		return { paceKgPerDay: null, projectedEndWeight: null, points: [] };
	}

	const sorted = [...args.actual].sort((a, b) => a.x - b.x);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	const span = Math.max(1, last.x - first.x);
	const pace = (last.weight - first.weight) / span;

	const totalWindowDays = Math.max(1, daysBetweenInclusive(args.periodStart, args.targetEnd) - 1);
	const projectedEndWeight = last.weight + pace * Math.max(0, totalWindowDays - last.x);

	const points: Array<{ x: number; weight: number }> = [];
	for (let x = last.x; x <= Math.min(args.xMax, totalWindowDays); x += 1) {
		points.push({ x, weight: Number((last.weight + pace * (x - last.x)).toFixed(3)) });
	}

	return {
		paceKgPerDay: Number(pace.toFixed(4)),
		projectedEndWeight: Number(projectedEndWeight.toFixed(3)),
		points
	};
}

function parseTargetWeight(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value.replace(',', '.'));
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const userId = locals.userId;
		const mode = url.searchParams.get('mode') === 'range' ? 'range' : 'comparison';
		const windowPreset = (url.searchParams.get('window') as WindowPreset | null) ?? '30d';
		const comparisonPeriods = Math.max(2, Math.min(6, Number.parseInt(url.searchParams.get('comparisonPeriods') || '3', 10)));

		const parsedStart = parseDate(url.searchParams.get('startDate'));
		const parsedEnd = parseDate(url.searchParams.get('endDate'));
		const rangeStart = parsedStart ? startOfDay(parsedStart) : null;
		const rangeEnd = parsedEnd ? endOfDay(parsedEnd) : null;

		const fallbackRange = buildRangeForPreset(windowPreset);
		const start = rangeStart ?? fallbackRange.start;
		const end = rangeEnd ?? fallbackRange.end;

		if (start > end) {
			return json({ success: false, message: 'startDate må være før endDate' }, { status: 400 });
		}

		if (mode === 'range') {
			const events = await loadWeightEvents(userId, start, end);
			const xMax = Math.max(0, daysBetweenInclusive(start, end) - 1);
			const points = normalizePeriodPoints(events, start, xMax);
			const yDomain = buildYDomain(points.map((p) => p.weight));

			return json({
				success: true,
				mode: 'range',
				range: {
					start: start.toISOString(),
					end: end.toISOString(),
					label: `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}`
				},
				x: {
					min: 0,
					max: xMax
				},
				y: yDomain,
				points,
				diagnostics: {
					source: 'sensor_events',
					eventCount: points.length
				}
			});
		}

		const current = buildRangeForPreset(windowPreset);
		const baseXMax = Math.max(0, daysBetweenInclusive(current.start, current.end) - 1);

		const series: Array<{
			label: string;
			isCurrent: boolean;
			start: string;
			end: string;
			points: WeightPoint[];
		}> = [];

		let periodCursor = { start: current.start, end: current.end };
		for (let i = 0; i < comparisonPeriods; i += 1) {
			const events = await loadWeightEvents(userId, periodCursor.start, periodCursor.end);
			const points = normalizePeriodPoints(events, periodCursor.start, baseXMax);

			series.push({
				label:
					i === 0
						? current.label
						: `${periodCursor.start.toISOString().slice(0, 10)} - ${periodCursor.end
								.toISOString()
								.slice(0, 10)}`,
				isCurrent: i === 0,
				start: periodCursor.start.toISOString(),
				end: periodCursor.end.toISOString(),
				points
			});

			periodCursor = previousMatchingRange(periodCursor.start, periodCursor.end, windowPreset);
		}

		const allWeights = series.flatMap((s) => s.points.map((p) => p.weight));
		const yDomain = buildYDomain(allWeights);

		let goalPayload: unknown = null;
		const goalId = url.searchParams.get('goalId');
		const goalStartDate = parseDate(url.searchParams.get('goalStartDate'));
		const goalEndDate = parseDate(url.searchParams.get('goalEndDate'));
		const explicitTargetWeight = parseTargetWeight(url.searchParams.get('targetWeight'));
		const explicitStartWeight = parseTargetWeight(url.searchParams.get('startWeight'));

		let resolvedTargetWeight = explicitTargetWeight;
		let resolvedGoalStart = goalStartDate;
		let resolvedGoalEnd = goalEndDate;

		if (goalId) {
			const goal = await db.query.goals.findFirst({
				where: and(eq(goals.id, goalId), eq(goals.userId, userId))
			});

			const metadata = (goal?.metadata ?? {}) as Record<string, unknown>;
			const metaStart = parseDate(typeof metadata.startDate === 'string' ? metadata.startDate : null);
			const metaEnd = parseDate(typeof metadata.endDate === 'string' ? metadata.endDate : null);
			const metaTargetValue = parseTargetWeight(metadata.targetValue);
			const metaStartValue = parseTargetWeight(metadata.startValue);

			resolvedGoalStart = resolvedGoalStart ?? metaStart;
			resolvedGoalEnd = resolvedGoalEnd ?? metaEnd;

			if (resolvedTargetWeight == null && metaTargetValue != null && metaStartValue != null) {
				resolvedTargetWeight = metaStartValue + metaTargetValue;
			}
		}

		const currentSeries = series[0]?.points ?? [];
		const latestCurrentWeight = currentSeries.length ? currentSeries[currentSeries.length - 1].weight : null;
		const derivedStartWeight = currentSeries.length ? currentSeries[0].weight : null;
		const resolvedStartWeight = explicitStartWeight ?? derivedStartWeight;

		if (
			resolvedGoalStart &&
			resolvedGoalEnd &&
			resolvedTargetWeight != null &&
			resolvedStartWeight != null
		) {
			const goalXMax = Math.max(baseXMax, daysBetweenInclusive(resolvedGoalStart, resolvedGoalEnd) - 1);
			const desired = buildDesiredLine({
				startWeight: resolvedStartWeight,
				targetWeight: resolvedTargetWeight,
				start: resolvedGoalStart,
				end: resolvedGoalEnd,
				xMax: goalXMax
			});
			const forecast = buildForecast({
				actual: currentSeries,
				targetEnd: resolvedGoalEnd,
				periodStart: resolvedGoalStart,
				xMax: goalXMax
			});

			goalPayload = {
				startDate: resolvedGoalStart.toISOString(),
				endDate: resolvedGoalEnd.toISOString(),
				startWeight: resolvedStartWeight,
				targetWeight: resolvedTargetWeight,
				latestWeight: latestCurrentWeight,
				targetDeltaKg: Number((resolvedTargetWeight - resolvedStartWeight).toFixed(3)),
				desired,
				forecast
			};
		}

		return json({
			success: true,
			mode: 'comparison',
			window: windowPreset,
			x: { min: 0, max: baseXMax },
			y: yDomain,
			series,
			goal: goalPayload,
			diagnostics: {
				source: 'sensor_events',
				totalPoints: allWeights.length,
				periods: series.map((s) => ({ label: s.label, points: s.points.length }))
			}
		});
	} catch (error) {
		console.error('Failed to load weight series:', error);
		return json({ success: false, message: 'Kunne ikke hente vektserie' }, { status: 500 });
	}
};
