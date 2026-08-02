import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveHealthSubthemeName } from '$lib/server/themes';

// Trening er blitt et undertema av Helse. Ruten beholdes som redirect fordi
// tolv steder dyplenker hit — nudges, actions, widgets og kort — og fordi den
// er målbar i bruksstatistikken.
//
// 302, aldri 301/308: målet er per bruker, og en permanent redirect ville blitt
// cachet i nettleseren og sendt neste bruker til feil tema.
export const load: PageServerLoad = async ({ locals, url }) => {
	const target = await resolveHealthSubthemeName(locals.userId, 'Trening');
	const query = url.search;

	if (target && 'name' in target) {
		redirect(302, `/tema/${encodeURIComponent(target.name.toLowerCase())}?tab=data${query.replace('?', '&')}`);
	}
	if (target && 'parentId' in target) {
		redirect(302, `/tema/${target.parentId}?tab=data`);
	}
	// Ingen helsekilde koblet ennå — hjem er den trygge landingen, ikke 404.
	redirect(302, '/');
};
