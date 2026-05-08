import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

export const VALID_WIDGET_METRICS = [
	'weight',
	'sleepDuration',
	'steps',
	'activeMinutes',
	'distance',
	'workoutCount',
	'heartrate',
	'mood',
	'screenTime',
	'amount'
] as const;

export const VALID_WIDGET_AGGS = ['avg', 'sum', 'count', 'latest', 'delta'] as const;
export const VALID_WIDGET_PERIODS = ['day', 'week', 'month'] as const;
export const VALID_WIDGET_RANGES = ['last7', 'last14', 'last30', 'current_week', 'current_month', 'current_year'] as const;

export type WidgetMetric = (typeof VALID_WIDGET_METRICS)[number];
export type WidgetAgg = (typeof VALID_WIDGET_AGGS)[number];
export type WidgetPeriod = (typeof VALID_WIDGET_PERIODS)[number];
export type WidgetRange = (typeof VALID_WIDGET_RANGES)[number];

export interface CreateWidgetInput {
	title: string;
	metricType: WidgetMetric;
	aggregation: WidgetAgg;
	period: WidgetPeriod;
	range: WidgetRange;
	filterCategory?: string | null;
	filterSubcategory?: string | null;
	metricKey?: string | null;
	goal?: number | null;
	unit: string;
	color?: string | null;
	pinned?: boolean;
	themeId?: string | null;
	sortOrder?: number;
}

export interface UpdateWidgetInput {
	pinned?: boolean;
	sortOrder?: number;
	title?: string;
	goal?: number | null;
	thresholdWarn?: number | null;
	thresholdSuccess?: number | null;
	color?: string;
	unit?: string;
	range?: WidgetRange;
	filterCategory?: string | null;
	filterSubcategory?: string | null;
}

function parseDecimal(value: string | null): number | null {
	return value != null ? parseFloat(value) : null;
}

function toClientWidget<T extends { goal: string | null; thresholdWarn: string | null; thresholdSuccess: string | null }>(
	widget: T
) {
	return {
		...widget,
		goal: parseDecimal(widget.goal),
		thresholdWarn: parseDecimal(widget.thresholdWarn),
		thresholdSuccess: parseDecimal(widget.thresholdSuccess)
	};
}

export interface ListWidgetsOptions {
	pinnedOnly?: boolean;
	// undefined = no surface filter (returns all)
	// null      = home screen widgets only (theme_id IS NULL)
	// string    = widgets belonging to that theme
	themeId?: string | null;
}

export async function listUserWidgets(userId: string, options: ListWidgetsOptions = {}) {
	const filters = [eq(userWidgets.userId, userId)];
	if (options.pinnedOnly) filters.push(eq(userWidgets.pinned, true));
	if (options.themeId === null) filters.push(isNull(userWidgets.themeId));
	else if (typeof options.themeId === 'string') filters.push(eq(userWidgets.themeId, options.themeId));

	const widgets = await db
		.select()
		.from(userWidgets)
		.where(and(...filters))
		.orderBy(asc(userWidgets.sortOrder), asc(userWidgets.createdAt));

	return widgets.map(toClientWidget);
}

export async function findSimilarWidget(
	userId: string,
	params: { metricType: WidgetMetric; range: WidgetRange; filterCategory?: string | null; themeId?: string | null },
	options?: { pinnedOnly?: boolean }
) {
	const filters = [
		eq(userWidgets.userId, userId),
		eq(userWidgets.metricType, params.metricType),
		eq(userWidgets.range, params.range),
		params.filterCategory
			? eq(userWidgets.filterCategory, params.filterCategory)
			: sql`filter_category IS NULL`
	];

	if (params.themeId === null) filters.push(isNull(userWidgets.themeId));
	else if (typeof params.themeId === 'string') filters.push(eq(userWidgets.themeId, params.themeId));

	if (options?.pinnedOnly) {
		filters.push(eq(userWidgets.pinned, true));
	}

	const existing = await db
		.select({ id: userWidgets.id, title: userWidgets.title })
		.from(userWidgets)
		.where(and(...filters))
		.limit(1);

	return existing[0] ?? null;
}

export async function createUserWidget(userId: string, input: CreateWidgetInput) {
	const [widget] = await db
		.insert(userWidgets)
		.values({
			userId,
			themeId: input.themeId ?? null,
			title: input.title.trim().slice(0, 80),
			metricType: input.metricType,
			aggregation: input.aggregation,
			period: input.period,
			range: input.range,
			goal: input.goal != null ? String(input.goal) : null,
			filterCategory: input.filterCategory ?? null,
			filterSubcategory: input.filterSubcategory ?? null,
			metricKey: input.metricKey ?? null,
			unit: input.unit.slice(0, 20),
			color: input.color || '#7c8ef5',
			pinned: input.pinned ?? false,
			sortOrder: input.sortOrder ?? 0
		})
		.returning();

	return toClientWidget(widget);
}

export async function listWidgetsForChat(userId: string) {
	return await db
		.select({
			id: userWidgets.id,
			title: userWidgets.title,
			metricType: userWidgets.metricType,
			aggregation: userWidgets.aggregation,
			period: userWidgets.period,
			range: userWidgets.range,
			unit: userWidgets.unit,
			goal: userWidgets.goal,
			thresholdWarn: userWidgets.thresholdWarn,
			thresholdSuccess: userWidgets.thresholdSuccess,
			color: userWidgets.color,
			pinned: userWidgets.pinned
		})
		.from(userWidgets)
		.where(eq(userWidgets.userId, userId))
		.orderBy(userWidgets.sortOrder, userWidgets.createdAt);
}

export async function updateUserWidget(userId: string, widgetId: string, updates: UpdateWidgetInput) {
	const payload: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof updates.pinned === 'boolean') payload.pinned = updates.pinned;
	if (typeof updates.sortOrder === 'number') payload.sortOrder = updates.sortOrder;
	if (typeof updates.title === 'string' && updates.title.trim()) payload.title = updates.title.trim().slice(0, 80);
	if (typeof updates.goal === 'number') payload.goal = String(updates.goal);
	if (updates.goal === null) payload.goal = null;
	if (typeof updates.thresholdWarn === 'number') payload.thresholdWarn = String(updates.thresholdWarn);
	if (updates.thresholdWarn === null) payload.thresholdWarn = null;
	if (typeof updates.thresholdSuccess === 'number') payload.thresholdSuccess = String(updates.thresholdSuccess);
	if (updates.thresholdSuccess === null) payload.thresholdSuccess = null;
	if (typeof updates.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(updates.color)) payload.color = updates.color;
	if (typeof updates.unit === 'string' && updates.unit.trim()) payload.unit = updates.unit.trim().slice(0, 20);
	if (typeof updates.range === 'string' && (VALID_WIDGET_RANGES as readonly string[]).includes(updates.range)) payload.range = updates.range;
	if (typeof updates.filterCategory === 'string' && updates.filterCategory.trim()) payload.filterCategory = updates.filterCategory.trim();
	if (updates.filterCategory === null) payload.filterCategory = null;
	if (typeof updates.filterSubcategory === 'string' && updates.filterSubcategory.trim()) payload.filterSubcategory = updates.filterSubcategory.trim();
	if (updates.filterSubcategory === null) payload.filterSubcategory = null;

	const [updated] = await db
		.update(userWidgets)
		.set(payload)
		.where(and(eq(userWidgets.id, widgetId), eq(userWidgets.userId, userId)))
		.returning();

	return updated ? toClientWidget(updated) : null;
}
