import { browser } from '$app/environment';
import { page } from '$app/state';
import { parseFargetema } from '$lib/domain/fargetema';

/**
 * Forhåndsvisning av fargetemaene i galleriet (docs/DESIGN.md, «Grunnregler»):
 * `?uttrykk=a` tegner siden i uttrykk A, `&fargetema=lys|mork` velger tema.
 * Påvirker bare visningen — brukerens cookie røres ikke. Kalles fra
 * komponentens initialisering, siden den setter opp en effekt.
 */
export function useFargetemaPreview(): { readonly uttrykk: 'a' | undefined } {
	const uttrykk = $derived(page.url.searchParams.get('uttrykk') === 'a' ? ('a' as const) : undefined);
	const forhandsvisning = $derived(page.url.searchParams.get('fargetema'));

	$effect(() => {
		if (!browser || !forhandsvisning) return;
		const html = document.documentElement;
		const forrige = html.dataset.fargetema;
		html.dataset.fargetema = parseFargetema(forhandsvisning);
		return () => {
			if (forrige === undefined) delete html.dataset.fargetema;
			else html.dataset.fargetema = forrige;
		};
	});

	return {
		get uttrykk() {
			return uttrykk;
		}
	};
}
