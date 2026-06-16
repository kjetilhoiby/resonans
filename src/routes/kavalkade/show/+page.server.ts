import type { PageServerLoad } from './$types';
import { loadKavalkadeData } from '$lib/server/kavalkade-data';
import { ensureBirthdayMagi } from '$lib/server/kavalkade-magi-gen';

export const load: PageServerLoad = async ({ locals }) => {
	const loaded = await loadKavalkadeData(locals.userId);
	// Showet går rett til avspilling (bl.a. fra bursdags-chipen), så det kan ikke
	// stole på at «hent»-knappene på /kavalkade er trykket. Etterfyll manglende
	// spådom + hilsner her — best effort, og cachet etter første visning.
	const { windows: _windows, ...data } = await ensureBirthdayMagi(locals.userId, loaded);
	return data;
};
