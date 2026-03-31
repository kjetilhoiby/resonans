<script lang="ts">
	import { onMount } from 'svelte';
	import GoalRing from '../ui/GoalRing.svelte';

	interface Props {
		widgetId: string;
		title: string;
		unit: string;
		color: string;
		pinned: boolean;
		onpress?: () => void;
		onchat?: (summary: string) => void;
		onunpin?: () => void;
		onconfig?: () => void;
	}

	let { widgetId, title, unit, color, pinned, onpress, onchat, onunpin, onconfig }: Props = $props();

	interface WidgetData {
		current: number | null;
		sparkline: number[];
		unit: string;
		delta: number | null;
		pct: number | null;
		state: 'success' | 'warn' | 'normal';
	}

	let data = $state<WidgetData | null>(null);
	let loading = $state(true);
	let error = $state(false);

	// Long-press for unpin
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let showUnpin = $state(false);
	let popupStyle = $state('');
	let dwEl: HTMLDivElement | null = null;

	function handlePressStart() {
		pressTimer = setTimeout(() => {
			// Plasser popupen basert på faktisk posisjon til widgeten
			if (dwEl) {
				const r = dwEl.getBoundingClientRect();
				const popupW = 150;
				const popupH = 110; // estimert høyde for tre knapper
				const margin = 8;
				// Senter horisontalt, klamper til skjermkanten
				let left = r.left + r.width / 2 - popupW / 2;
				left = Math.max(margin, Math.min(left, window.innerWidth - popupW - margin));
				// Vis over widgeten hvis det er plass, ellers under
				const spaceAbove = r.top;
				if (spaceAbove >= popupH + margin) {
					const bottom = window.innerHeight - r.top + 6;
					popupStyle = `position:fixed; left:${left}px; bottom:${bottom}px; width:${popupW}px;`;
				} else {
					const top = r.bottom + 6;
					popupStyle = `position:fixed; left:${left}px; top:${top}px; width:${popupW}px;`;
				}
			}
			showUnpin = true;
		}, 600);
	}

	function handlePressEnd(e: PointerEvent) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		// Hindre click-event fra å fyre etter langt trykk
		if (showUnpin) e.preventDefault();
	}

	function handleClick() {
		if (showUnpin) return;
		onpress?.();
	}

	onMount(async () => {
		try {
			const res = await fetch(`/api/widget-data/${widgetId}`);
			if (res.ok) {
				data = await res.json();
			} else {
				error = true;
			}
		} catch {
			error = true;
		} finally {
			loading = false;
		}
	});

	const displayVal = $derived.by(() => {
		if (!data || data.current == null) return '–';
		const v = data.current;
		if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
		if (Number.isInteger(v)) return String(v);
		return v.toFixed(1);
	});

	const displayUnit = $derived(data?.unit ?? unit);

	const pct = $derived(data?.pct ?? null);

	// Fargestyring: state overstyrer standard widget-farge
	const STATE_COLORS = { success: '#82c882', warn: '#f0b429', normal: null };
	const displayColor = $derived(
		data?.state && data.state !== 'normal' ? STATE_COLORS[data.state] : color
	);

	const chatSummary = $derived.by(() => {
		if (!data) return title;
		if (data.delta != null && data.delta !== 0) {
			const sign = data.delta > 0 ? '+' : '';
			const formatted = Number.isInteger(data.delta)
				? `${sign}${data.delta}`
				: `${sign}${data.delta.toFixed(1)}`;
			return `${formatted} ${data.unit ?? unit} – ${title.toLowerCase()}`;
		}
		if (data.current != null) {
			return `${displayVal} ${displayUnit} – ${title.toLowerCase()}`;
		}
		return title;
	});
</script>

<div
	bind:this={dwEl}
	class="dw"
	role="button"
	tabindex="0"
	onpointerdown={handlePressStart}
	onpointerup={handlePressEnd}
	onpointerleave={handlePressEnd}
	onclick={handleClick}
	onkeydown={(e) => e.key === 'Enter' && handleClick()}
	style:--c={displayColor}
>
	{#if loading}
		<div class="dw-loading" aria-label="Laster…">
			<div class="spinner" style:border-top-color={displayColor}></div>
		</div>
	{:else if error}
		<div class="dw-error">–</div>
	{:else}
		<!-- Ring -->
		<div class="dw-ring">
			{#if pct != null}
				<GoalRing {pct} size={70} strokeWidth={4} color={displayColor} />
			{:else}
				<div class="dw-plain-circle" style:border-color={displayColor}></div>
			{/if}
			<div class="dw-val">{displayVal}</div>
		</div>

		<!-- Label -->
		<div class="dw-label" style:color={displayColor}>{displayUnit}</div>

		<!-- Unpin popup -->
		{#if showUnpin}
			<!-- Overlay fanger klikk utenfor popupen og lukker den -->
			<div
				class="dw-overlay"
				role="presentation"
				onpointerdown={(e) => { e.stopPropagation(); showUnpin = false; }}
			></div>
			<div class="dw-popup" role="dialog" aria-label="Widget-alternativer" style={popupStyle}>
				<button
					class="dw-popup-btn dw-popup-chat"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); showUnpin = false; onchat?.(chatSummary); }}
					aria-label="Start chat om denne widgeten"
				>
					Start chat
				</button>
				<button
					class="dw-popup-btn dw-popup-config"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); showUnpin = false; onconfig?.(); }}
					aria-label="Konfigurer widget"
				>
					Konfigurer
				</button>
				<button
					class="dw-popup-btn"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); showUnpin = false; onunpin?.(); }}
					aria-label="Fjern fra hjemskjerm"
				>
					Fjern fra hjem
				</button>
				<button
					class="dw-popup-cancel"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); showUnpin = false; }}
					aria-label="Avbryt"
				>
					Avbryt
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.dw {
		position: relative;
		width: 90px;
		min-height: 106px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
	}

	.dw-loading,
	.dw-error {
		width: 56px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid #333;
		border-top-color: var(--c);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.dw-ring {
		position: relative;
		width: 70px;
		height: 70px;
	}

	.dw-plain-circle {
		width: 64px;
		height: 64px;
		border: 3px solid var(--c);
		border-radius: 50%;
		margin: 3px;
		opacity: 0.3;
	}

	.dw-val {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		font-weight: 700;
		color: #eee;
		line-height: 1;
	}

	.dw-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		text-align: center;
		opacity: 0.8;
	}

	.dw-overlay {
		position: fixed;
		inset: 0;
		z-index: 199;
	}

	.dw-popup {
		/* Posisjon settes via inline style (fixed, beregnet i handlePressStart) */
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 10px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 200;
		box-shadow: 0 4px 20px rgba(0,0,0,0.6);
	}

	.dw-popup-btn {
		background: none;
		border: none;
		color: #e07070;
		font-size: 0.8rem;
		padding: 6px 10px;
		border-radius: 6px;
		cursor: pointer;
		text-align: center;
	}
	.dw-popup-btn:hover {
		background: #2a1a1a;
	}

	.dw-popup-chat {
		color: #7c8ef5;
		border-bottom: 1px solid #2a2a2a;
		border-radius: 6px 6px 0 0;
	}
	.dw-popup-chat:hover {
		background: #1a1a2e;
	}

	.dw-popup-config {
		color: #aaa;
		border-bottom: 1px solid #2a2a2a;
		border-radius: 0;
		margin-bottom: 2px;
	}
	.dw-popup-config:hover {
		background: #222;
	}

	.dw-popup-cancel {
		background: none;
		border: none;
		color: #555;
		font-size: 0.75rem;
		padding: 4px 10px;
		cursor: pointer;
		text-align: center;
	}
	.dw-popup-cancel:hover {
		color: #888;
	}
</style>
