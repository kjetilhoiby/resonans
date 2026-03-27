<!--
  WidgetCircle — liten tappbar sirkel som viser én nøkkelverdi.
  Kollaps-tilstand i Sone 1 på hjemskjermen.

  Props:
    label      sensornavnet (f.eks. "Vekt")
    val        verdi (f.eks. "92.1" eller "−0.4")
    unit       enhet (f.eks. "kg" eller "h")
    color      aksentfarge
    active     om sirkelen er valgt/aktiv
    onpress    callback for kort trykk (åpner sensor-dashboard)
    onchat     callback for langt trykk (≥700ms, åpner kontekstuell chat)
-->
<script lang="ts">
	interface Props {
		label: string;
		val: string;
		unit: string;
		color?: string;
		active?: boolean;
		onpress?: () => void;
		onchat?: () => void;
	}

	let {
		label,
		val,
		unit,
		color = '#7c8ef5',
		active = false,
		onpress,
		onchat,
	}: Props = $props();

	let longpressTimer: ReturnType<typeof setTimeout> | undefined;
	let pressing = $state(false);

	function handlePointerDown() {
		pressing = true;
		longpressTimer = setTimeout(() => {
			pressing = false;
			longpressTimer = undefined;
			onchat?.();
		}, 700);
	}

	function handlePointerUp() {
		if (longpressTimer) {
			clearTimeout(longpressTimer);
			longpressTimer = undefined;
			onpress?.();
		}
		pressing = false;
	}

	function handlePointerLeave() {
		clearTimeout(longpressTimer);
		longpressTimer = undefined;
		pressing = false;
	}
</script>

<div
	class="widget-circ"
	class:active
	class:pressing
	style="--c:{color}"
	role="button"
	tabindex="0"
	aria-label="{label}: {val} {unit}"
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
	onpointerleave={handlePointerLeave}
	onkeydown={(e) => e.key === 'Enter' && onpress?.()}
>
	<span class="wc-val">{val}</span>
	<span class="wc-unit">{unit}</span>
	<span class="wc-label">{label}</span>
</div>

<style>
	.widget-circ {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 1.5px solid color-mix(in srgb, var(--c) 35%, #2a2a2a);
		background: radial-gradient(
			ellipse at 40% 35%,
			color-mix(in srgb, var(--c) 12%, #1a1a1a),
			#111
		);
		box-shadow: 0 0 16px color-mix(in srgb, var(--c) 10%, transparent);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
		cursor: pointer;
		transition:
			transform 0.12s,
			box-shadow 0.12s,
			border-color 0.15s;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.widget-circ.active,
	.widget-circ:hover {
		border-color: color-mix(in srgb, var(--c) 60%, #2a2a2a);
		box-shadow: 0 0 24px color-mix(in srgb, var(--c) 22%, transparent);
	}

	.widget-circ.pressing {
		transform: scale(0.93);
	}

	.wc-val {
		font-size: 1rem;
		font-weight: 700;
		color: var(--c);
		line-height: 1;
		letter-spacing: -0.02em;
	}

	.wc-unit {
		font-size: 0.55rem;
		color: color-mix(in srgb, var(--c) 60%, #555);
		line-height: 1.2;
		text-transform: lowercase;
	}

	.wc-label {
		font-size: 0.5rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-top: 2px;
		line-height: 1;
	}
</style>
