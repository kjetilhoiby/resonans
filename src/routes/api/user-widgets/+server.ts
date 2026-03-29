/**
 * GET  /api/user-widgets          — liste alle widgets (query: ?pinned=true)
 * POST /api/user-widgets          — opprett nytt widget
 */
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const pinnedOnly = url.searchParams.get('pinned') === 'true';

	const where = pinnedOnly
		? and(eq(userWidgets.userId, userId), eq(userWidgets.pinned, true))
		: eq(userWidgets.userId, userId);

	const widgets = await db
		.select()
		.from(userWidgets)
		.where(where)
		.orderBy(asc(userWidgets.sortOrder), asc(userWidgets.createdAt));

	// Transform decimal strings to numbers for frontend
	const transformedWidgets = widgets.map(w => ({
		...w,
		goal: w.goal ? parseFloat(w.goal) : null,
		thresholdWarn: w.thresholdWarn ? parseFloat(w.thresholdWarn) : null,
		thresholdSuccess: w.thresholdSuccess ? parseFloat(w.thresholdSuccess) : null,
	}));

	return json(transformedWidgets);
};

const VALID_METRICS = ['weight', 'sleepDuration', 'steps', 'distance', 'workoutCount', 'heartrate', 'mood', 'screenTime', 'amount'] as const;
const VALID_AGGS = ['avg', 'sum', 'count', 'latest'] as const;
const VALID_PERIODS = ['day', 'week', 'month'] as const;
const VALID_RANGES = ['last7', 'last14', 'last30', 'current_week', 'current_month', 'current_year'] as const;

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const { title, metricType, aggregation, period, range, goal, unit, color, pinned } = body;

	if (!title || typeof title !== 'string' || title.trim().length === 0) {
		throw error(400, 'title er påkrevd');
	}
	if (!VALID_METRICS.includes(metricType)) {
		throw error(400, `Ugyldig metricType: ${metricType}`);
	}
	if (!VALID_AGGS.includes(aggregation)) {
		throw error(400, `Ugyldig aggregation: ${aggregation}`);
	}
	if (!VALID_PERIODS.includes(period)) {
		throw error(400, `Ugyldig period: ${period}`);
	}
	if (!VALID_RANGES.includes(range)) {
		throw error(400, `Ugyldig range: ${range}`);
	}
	if (!unit || typeof unit !== 'string') {
		throw error(400, 'unit er påkrevd');
	}
	if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
		throw error(400, 'color må være en hex-farge (#rrggbb)');
	}

	const [widget] = await db
		.insert(userWidgets)
		.values({
			userId,
			title: title.trim().slice(0, 80),
			metricType,
			aggregation,
			period,
			range,
			goal: goal != null ? String(goal) : null,
			unit: unit.slice(0, 20),
			color: color || '#7c8ef5',
			pinned: Boolean(pinned),
			sortOrder: 0,
		})
		.returning();

	// Transform decimal strings to numbers for frontend
	const transformed = {
		...widget,
		goal: widget.goal ? parseFloat(widget.goal) : null,
		thresholdWarn: widget.thresholdWarn ? parseFloat(widget.thresholdWarn) : null,
		thresholdSuccess: widget.thresholdSuccess ? parseFloat(widget.thresholdSuccess) : null,
	};

	return json(transformed, { status: 201 });
};
