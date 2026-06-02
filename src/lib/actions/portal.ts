/**
 * Svelte action som flytter noden til `document.body` (eller et gitt mål) så
 * lenge den er montert.
 *
 * Hvorfor: en `position: fixed`-overlay som ligger inne i en stamfar med
 * `transform` / `will-change: transform` (f.eks. `PullToRefresh` sin
 * `.ptr-content`) blir festet til DENNE stamfaren i stedet for viewporten.
 * Resultatet er at f.eks. persondetaljkortet på familiesida dukker opp i bunnen
 * av hele sideinnholdet i stedet for nederst på skjermen — «sykt langt ned fra
 * familietreet». Ved å portalere overlayen ut til <body> slipper den unna det
 * transformerte sjiktet og forankres mot viewporten igjen.
 *
 * Svelte-event-handlere og scoped styles følger med noden, så
 * onclick/`stopPropagation` og klassebasert styling fungerer som før.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
	let targetEl: HTMLElement | null = null;

	function mount(t: HTMLElement | string) {
		targetEl = typeof t === 'string' ? document.querySelector<HTMLElement>(t) : t;
		targetEl?.appendChild(node);
	}

	mount(target);

	return {
		update(t: HTMLElement | string) {
			mount(t);
		},
		destroy() {
			node.parentNode?.removeChild(node);
		}
	};
}
