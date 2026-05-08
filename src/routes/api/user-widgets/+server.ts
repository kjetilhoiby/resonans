/**
 * GET  /api/user-widgets          — liste widgets (default: hjemmeskjerm, themeId IS NULL)
 *                                    Query: ?pinned=true | ?themeId=<uuid> | ?scope=all
 * POST /api/user-widgets          — opprett nytt widget (body kan inkludere themeId)
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
	const themeIdParam = url.searchParams.get('themeId');
	const scope = url.searchParams.get('scope');

	let themeId: string | null | undefined;
	if (scope === 'all') themeId = undefined;
	else if (themeIdParam) themeId = themeIdParam;
	else themeId = null;

	return json(await listUserWidgets(userId, { pinnedOnly, themeId }));
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const { title, metricType, aggregation, period, range, filterCategory, goal, unit, color, pinned, themeId } = body;

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

	if (themeId != null && (typeof themeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(themeId))) {
		throw error(400, 'themeId må være en gyldig uuid');
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
		pinned: Boolean(pinned),
		themeId: typeof themeId === 'string' ? themeId : null
	});

	return json(widget, { status: 201 });
};
