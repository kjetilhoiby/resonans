import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getThemeResearchDomains,
	setThemeResearchDomains
} from '$lib/server/services/theme-research-service';

// GET /api/tema/[id]/research-domains — hent foretrukne/ekskluderte kilder.
export const GET: RequestHandler = async ({ params, locals }) => {
	const domains = await getThemeResearchDomains(params.id, locals.userId);
	if (domains === null) return json({ error: 'Not found' }, { status: 404 });
	return json(domains);
};

// PUT /api/tema/[id]/research-domains — sett foretrukne/ekskluderte kilder.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as {
		include?: unknown;
		exclude?: unknown;
	};
	const toArray = (v: unknown): string[] =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

	const saved = await setThemeResearchDomains(params.id, locals.userId, {
		include: toArray(body.include),
		exclude: toArray(body.exclude)
	});
	if (saved === null) return json({ error: 'Not found' }, { status: 404 });
	return json(saved);
};
