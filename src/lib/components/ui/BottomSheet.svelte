<!--
  BottomSheet — delt skall for bottompaneler: backdrop + fly-inn-sheet.
  Brukes av ChecklistSheet og ProcedureSheet (kanonisk skin: radius 24,
  maks 90dvh, maks-bredde 520, z 200/201). WidgetConfigSheet og FlowSheet
  har bevisst avvikende skall og migreres når skinnene samkjøres.

  Innholdet (children) eier header/scroll/footer selv — skallet er
  flex-kolonne med overflow hidden.

  Backdrop og sheet portaleres til <body> (use:portal). Uten dette fester
  `position: fixed` seg til nærmeste transformerte stamfar — f.eks.
  `PullToRefresh` sin `.ptr-content` (will-change: transform) som wrapper
  tema-, ukeplan- og hjemsidene. Da havner panelet i bunnen av HELE
  sideinnholdet i stedet for nederst i viewporten («laaangt nede på siden»).
-->
<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Snippet } from 'svelte';
	import { portal } from '$lib/actions/portal';

	interface Props {
		onclose: () => void;
		ariaLabel?: string;
		maxWidth?: number;
		children: Snippet;
	}

	let { onclose, ariaLabel, maxWidth = 520, children }: Props = $props();
</script>

<div class="bs-backdrop" use:portal transition:fade={{ duration: 200 }} onclick={onclose} role="presentation"></div>

<div
	class="bs-sheet"
	use:portal
	transition:fly={{ y: 40, duration: 350, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label={ariaLabel}
	style:max-width={`${maxWidth}px`}
>
	{@render children()}
</div>

<style>
	.bs-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 200;
	}

	.bs-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 90dvh;
		background: var(--sheet-bg, #111);
		border-radius: 24px 24px 0 0;
		border-top: 1px solid var(--sheet-border, #222);
		z-index: 201;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		margin: 0 auto;
	}
</style>
