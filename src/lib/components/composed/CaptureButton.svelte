<!--
  CaptureButton — den flytende veien inn til Én inngang (CaptureSheet).
  Vises fra rot-layouten på sider uten eget chatfelt; regelen bor i
  `showFloatingCapture` ($lib/domain/capture.ts). Hjemskjermen har sin egen
  knapp i toppraden og bruker ikke denne.
-->
<script lang="ts">
	import Icon from '../ui/Icon.svelte';
	import CaptureSheet from './CaptureSheet.svelte';

	let open = $state(false);
</script>

<button
	class="capture-fab"
	type="button"
	aria-label="Legg inn"
	data-track="inngang:apne-flytende"
	onclick={() => (open = true)}
>
	<Icon name="plus" size={22} />
</button>

{#if open}
	<CaptureSheet onclose={() => (open = false)} />
{/if}

<style>
	/* Knappen ligger i rot-layouten, utenfor AppPage; fargene kommer fra
	   <body data-uttrykk>, som arket — se CaptureSheet. */
	.capture-fab {
		position: fixed;
		right: 16px;
		bottom: calc(18px + env(safe-area-inset-bottom, 0px));
		z-index: 150;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 1px solid var(--border-color);
		background: var(--bg-card);
		color: var(--text-primary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-md);
		cursor: pointer;
	}
	.capture-fab:hover {
		border-color: var(--accent-primary);
	}
	@media print {
		.capture-fab {
			display: none;
		}
	}
</style>
