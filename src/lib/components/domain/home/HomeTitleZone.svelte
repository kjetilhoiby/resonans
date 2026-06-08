<!--
  SONE 1: Tittel
  Viser app-tittel som morpher til dato, pluss innstillinger-lenker og egenfrekvens-prompt.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import MorphTitle from '../../ui/MorphTitle.svelte';
	import Icon from '../../ui/Icon.svelte';
	import EgenfrekvensPrompt from '../EgenfrekvensPrompt.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
</script>

{#if !ctx.inputExpanded}
	<section class="zone zone-title" out:fly={{ y: -24, duration: 750 }} in:fly={{ y: -14, duration: 600 }}>
		<div class="title-row">
			<MorphTitle
				from="Resonans"
				to={ctx.dateLabel}
				onpress={() => { startNavMetric('home', 'ukeplan'); void goto('/ukeplan'); }}
				ariaLabel="Åpne ukeplan"
			/>
			<div class="title-right">
				<a href="/plan/mal" class="icon-link" aria-label="Mål"><Icon name="goals" size={20} /></a>
				<a href="/settings" class="icon-link" aria-label="Innstillinger"><Icon name="settings" size={18} /></a>
			</div>
		</div>
		{#if ctx.egenfrekvensPromptOpen}
			<EgenfrekvensPrompt
				onstart={() => {
					ctx.egenfrekvensPromptOpen = false;
					ctx.egenfrekvensFlowOpen = true;
				}}
				ondismiss={() => {
					if (typeof localStorage !== 'undefined' && ctx.egenfrekvensPromptDay) {
						localStorage.setItem(`egenfrekvens-prompt-dismissed-${ctx.egenfrekvensPromptDay}`, '1');
					}
					ctx.egenfrekvensPromptOpen = false;
				}}
			/>
		{/if}
	</section>
{/if}

<style>
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	.zone-title {
		flex: 10 0 0;
		min-height: 0;
		display: flex;
		align-items: flex-start;
		padding:
			var(--screen-title-top-pad, 34px)
			max(16px, env(safe-area-inset-right, 0px))
			0
			max(16px, env(safe-area-inset-left, 0px));
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-width: 0;
		gap: 8px;
	}

	.title-row :global(.morph-title) {
		min-width: 0;
		flex: 1 1 auto;
	}

	.title-row :global(.morph-title-text) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-right {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.icon-link {
		color: #555;
		text-decoration: none;
		min-width: 40px;
		min-height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s;
	}

	.icon-link:hover {
		color: #aaa;
	}
</style>
