import type { PageServerLoad } from './$types';
import { loadKavalkadeData } from '$lib/server/kavalkade-data';

export const load: PageServerLoad = async ({ locals }) => {
	const { windows: _windows, ...data } = await loadKavalkadeData(locals.userId);
	return data;
};
