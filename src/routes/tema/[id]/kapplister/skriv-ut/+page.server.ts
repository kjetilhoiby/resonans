import { db } from '$lib/db';
import { themes, cutLists } from '$lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, locals, url }) => {
	// Tema kan slås opp på UUID eller navn (som hovedsiden).
	const theme = UUID_RE.test(params.id)
		? await db.query.themes.findFirst({ where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)) })
		: await db.query.themes.findFirst({
				where: and(
					eq(themes.name, params.id.charAt(0).toUpperCase() + params.id.slice(1)),
					eq(themes.userId, locals.userId)
				)
			});
	if (!theme) error(404, 'Tema ikke funnet');

	const rows = await db
		.select()
		.from(cutLists)
		.where(and(eq(cutLists.themeId, theme.id), eq(cutLists.userId, locals.userId)))
		.orderBy(asc(cutLists.sortOrder), asc(cutLists.createdAt));

	// Valgfritt filter til én liste via ?list=<id>.
	const onlyList = url.searchParams.get('list');
	const filtered = onlyList ? rows.filter((r) => r.id === onlyList) : rows;

	return {
		themeName: theme.name,
		cutLists: filtered
			.filter((r) => (r.materials ?? []).length > 0)
			.map((r) => ({
				id: r.id,
				title: r.title,
				kerfMm: r.kerfMm,
				guillotine: r.guillotine,
				transportEnabled: r.transportEnabled,
				transportMaxLengthMm: r.transportMaxLengthMm,
				transportMaxWidthMm: r.transportMaxWidthMm,
				materials: r.materials ?? []
			}))
	};
};
