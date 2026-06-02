/**
 * Svelte-action som flytter noden til `document.body` (eller et annet mål).
 *
 * Brukes for overlay/bottom-sheets som ligger dypt nede i et tre der en
 * forelder har `transform`/`contain`/`filter` — slikt gjør at `position: fixed`
 * forankres til forelderen i stedet for viewporten, og arket havner «langt
 * unna». Ved å portale til body unngår vi det helt.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = document.body) {
	let targetEl: HTMLElement | null = null;

	function mount(t: HTMLElement | string) {
		targetEl = typeof t === 'string' ? document.querySelector<HTMLElement>(t) : t;
		if (targetEl) targetEl.appendChild(node);
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
