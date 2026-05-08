import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildEgenfrekvensReflectionContext } from '$lib/server/egenfrekvens-reflection-context';

export const GET: RequestHandler = async ({ locals, url }) => {
	const dayParam = url.searchParams.get('day');
	const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : new Date().toISOString().slice(0, 10);
	const recentLimitParam = Number(url.searchParams.get('recentLimit'));
	const recentLimit = Number.isFinite(recentLimitParam) && recentLimitParam > 0 && recentLimitParam <= 30
		? recentLimitParam
		: undefined;

	const context = await buildEgenfrekvensReflectionContext(locals.userId, { day, recentLimit });
	return json(context);
};
