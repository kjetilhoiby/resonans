<!--
  SONE 1: Tittel
  Viser app-tittel som morpher til dato, pluss innstillinger-lenker og egenfrekvens-prompt.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import { PageHeader } from '../../ui';
	import Icon from '../../ui/Icon.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
</script>

{#if !ctx.inputExpanded}
	<section class="zone zone-title" out:fly={{ y: -24, duration: 750 }} in:fly={{ y: -14, duration: 600 }}>
		<PageHeader
			title="Resonans"
			morph={{ to: ctx.dateLabel }}
			onTitleClick={() => { startNavMetric('home', 'ukeplan'); void goto('/ukeplan'); }}
			titleLabel="Åpne ukeplan"
		>
			{#snippet actions()}
				{#each ctx.activeFerie as ferie (ferie.id)}
					<a
						href="/tema/{ferie.id}?tab=data"
						class="icon-link ferie-link"
						aria-label={`Ferie: ${ferie.name}`}
						title={ferie.name}
						onclick={() => startNavMetric('home', 'tema')}
					>{ferie.emoji}</a>
				{/each}
				<a href="/plan/mal" class="icon-link" aria-label="Mål"><Icon name="goals" size={20} /></a>
				<a href="/settings" class="icon-link" aria-label="Innstillinger"><Icon name="settings" size={18} /></a>
			{/snippet}
		</PageHeader>
	</section>
{/if}

<style>
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	.zone-title {
		flex-shrink: 0;
		padding-bottom: var(--page-pt);
	}

	.title-right {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.icon-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #8a99c4;
		text-decoration: none;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}

	.icon-link:hover {
		background: #12162a;
		color: #bac6f9;
		border-color: #2e3660;
	}

	/* Ferie-snarvei: emoji i stedet for ikon, litt varmere ramme. */
	.ferie-link {
		font-size: 1.1rem;
		line-height: 1;
		border-color: #2c2740;
	}
</style>
