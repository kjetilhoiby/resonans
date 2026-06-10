<!--
  ThemeFlowsTab — Flyter-fanen i ThemePage.
  Viser tilgjengelige flyter for temaet med grid-layout.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import FlowCard from '../../flows/FlowCard.svelte';
	import type { Flow } from '$lib/flows/types';

	interface Props {
		themeName: string;
		availableFlows: Flow[];
		onStartFlow: (flow: Flow) => void;
	}

	let { themeName, availableFlows, onStartFlow }: Props = $props();
</script>

<div class="flows-panel">
	{#if availableFlows.length > 0}
		<div class="flows-section">
			<SectionLabel tag="h2">Tilgjengelige flyter</SectionLabel>
			<p class="flows-section-copy">Strukturerte flyter som hjelper deg i gang med {themeName}.</p>
			<div class="flows-grid">
				{#each availableFlows as flow}
					<FlowCard {flow} onstart={() => onStartFlow(flow)} />
				{/each}
			</div>
		</div>
	{:else}
		<div class="flows-empty">
			<p class="flows-empty-message">Ingen flyter tilgjengelig for dette temaet ennå.</p>
		</div>
	{/if}
</div>

<style>
	.flows-panel {
		padding: 16px var(--page-px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.flows-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.flows-section-copy {
		margin: 0 0 18px 0;
		padding: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft, hsl(228 18% 70%));
		line-height: 1.5;
	}

	.flows-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
		margin-bottom: 24px;
	}

	.flows-empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--tp-text-muted, hsl(228 12% 46%));
		font-size: 0.88rem;
		border: 1px dashed var(--tp-border, hsl(228 16% 18%));
		border-radius: 12px;
		background: var(--tp-bg-1, hsl(228 20% 10%));
	}
</style>
