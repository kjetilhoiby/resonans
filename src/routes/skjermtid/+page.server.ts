import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveHealthSubthemeName } from '$lib/server/themes';

// Skjermtid er blitt et undertema av Helse. Se kommentaren i /trening for
// hvorfor ruten beholdes som 302-redirect til det navnebaserte URL-et.
export const load: PageServerLoad = async ({ locals, url }) => {
	const target = await resolveHealthSubthemeName(locals.userId, 'Skjermtid');
	const query = url.search;

	if (target && 'name' in target) {
		redirect(302, `/tema/${encodeURIComponent(target.name.toLowerCase())}?tab=data${query.replace('?', '&')}`);
	}
	if (target && 'parentId' in target) {
		redirect(302, `/tema/${target.parentId}?tab=data`);
	}
	redirect(302, '/');
};
