/**
 * Gjenbrukbar langtrykk-action (pointer-basert), etter samme mønster som
 * `ChecklistItemRow`/dagsoppgavelistene, men uten å duplisere timer-logikken.
 *
 * Bruk:
 *   <img use:longpress={{ onLongPress: (rect) => openMenu(rect) }} />
 *
 * Kaller `onLongPress` med elementets DOMRect etter `duration` ms, avbryter ved
 * bevegelse over `moveTolerance` px, og svelger det påfølgende klikket slik at
 * langtrykk ikke også trigger en vanlig click.
 */

export interface LongpressOptions {
	onLongPress: (rect: DOMRect) => void;
	duration?: number;
	moveTolerance?: number;
}

export function longpress(node: HTMLElement, options: LongpressOptions) {
	let opts = options;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let triggered = false;
	let startX = 0;
	let startY = 0;

	function clear() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function onPointerDown(e: PointerEvent) {
		triggered = false;
		startX = e.clientX;
		startY = e.clientY;
		clear();
		timer = setTimeout(() => {
			triggered = true;
			timer = null;
			if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
			opts.onLongPress(node.getBoundingClientRect());
		}, opts.duration ?? 500);
	}

	function onPointerMove(e: PointerEvent) {
		if (!timer) return;
		const tol = opts.moveTolerance ?? 10;
		if (Math.abs(e.clientX - startX) > tol || Math.abs(e.clientY - startY) > tol) clear();
	}

	function onPointerEnd() {
		clear();
	}

	function onClickCapture(e: MouseEvent) {
		if (triggered) {
			e.preventDefault();
			e.stopPropagation();
			triggered = false;
		}
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerEnd);
	node.addEventListener('pointercancel', onPointerEnd);
	node.addEventListener('pointerleave', onPointerEnd);
	node.addEventListener('click', onClickCapture, true);

	return {
		update(next: LongpressOptions) {
			opts = next;
		},
		destroy() {
			clear();
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerEnd);
			node.removeEventListener('pointercancel', onPointerEnd);
			node.removeEventListener('pointerleave', onPointerEnd);
			node.removeEventListener('click', onClickCapture, true);
		}
	};
}
