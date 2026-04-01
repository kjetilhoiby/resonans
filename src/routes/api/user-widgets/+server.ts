/**
 * GET  /api/user-widgets          — liste alle widgets (query: ?pinned=true)
 * POST /api/user-widgets          — opprett nytt widget
 */
import { json, error } from '@sveltejs/kit';
import {
	VALID_WIDGET_AGGS,
	VALID_WIDGET_METRICS,
	VALID_WIDGET_PERIODS,
	VALID_WIDGET_RANGES,
	createUserWidget,
	listUserWidgets
} from '$lib/skills/widget-creation/service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const pinnedOnly = url.searchParams.get('pinned') === 'true';
	return json(await listUserWidgets(userId, pinnedOnly));
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const { title, metricType, aggregation, period, range, filterCategory, goal, unit, color, pinned } = body;

	if (!title || typeof title !== 'string' || title.trim().length === 0) {
		throw error(400, 'title er påkrevd');
	}
	if (!VALID_WIDGET_METRICS.includes(metricType)) {
		throw error(400, `Ugyldig metricType: ${metricType}`);
	}
	if (!VALID_WIDGET_AGGS.includes(aggregation)) {
		throw error(400, `Ugyldig aggregation: ${aggregation}`);
	}
	if (!VALID_WIDGET_PERIODS.includes(period)) {
		throw error(400, `Ugyldig period: ${period}`);
	}
	if (!VALID_WIDGET_RANGES.includes(range)) {
		throw error(400, `Ugyldig range: ${range}`);
	}
	if (!unit || typeof unit !== 'string') {
		throw error(400, 'unit er påkrevd');
	}
	if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
		throw error(400, 'color må være en hex-farge (#rrggbb)');
	}

	const widget = await createUserWidget(userId, {
		title,
		metricType,
		aggregation,
		period,
		range,
		filterCategory: filterCategory ?? null,
		goal: goal ?? null,
		unit,
		color: color ?? null,
		pinned: Boolean(pinned)
	});

	return json(widget, { status: 201 });
};
