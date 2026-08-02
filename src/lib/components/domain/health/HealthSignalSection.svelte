<!--
  HealthSignalSection — «Sammenhenger» på helse-mortemaet.

  Signalene i domain_signals har alltid vært beregnet, men aldri vist noe sted;
  de har kun matet nudge-motoren. Her løftes de opp som lesbare kort med
  kryss-lenker, slik at mordashboardet faktisk svarer på hvordan grenene henger
  sammen.

  Sortering og filtrering skjer serverside (rankSignalsForOverview).
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import SignalCard from '../../composed/SignalCard.svelte';
	import type { PresentedSignal } from '$lib/domain/health/signal-presentation';

	interface Props {
		signals: PresentedSignal[];
		/** Undertemanavn → temaid, for kryss-lenkene. */
		themeIdsByName?: Record<string, string>;
		parentThemeId?: string | null;
	}

	let { signals, themeIdsByName = {}, parentThemeId = null }: Props = $props();

	function hrefFor(label: string): string | null {
		if (label === 'Helse') return parentThemeId ? `/tema/${parentThemeId}` : null;
		const id = themeIdsByName[label];
		return id ? `/tema/${id}` : null;
	}

	function metaFor(observedAt: string): string | null {
		const observed = new Date(observedAt);
		if (Number.isNaN(observed.getTime())) return null;
		const days = Math.floor((Date.now() - observed.getTime()) / 86_400_000);
		if (days <= 0) return 'målt i dag';
		if (days === 1) return 'målt i går';
		return `målt for ${days} dager siden`;
	}
</script>

{#if signals.length > 0}
	<section class="signal-section">
		<SectionLabel tag="h2">Sammenhenger</SectionLabel>
		<div class="signal-list">
			{#each signals as signal (signal.signalType)}
				<SignalCard
					title={signal.title}
					sentence={signal.sentence}
					tone={signal.tone}
					meta={metaFor(signal.observedAt)}
					crossLinks={signal.crossLinks.map((label) => ({ label, href: hrefFor(label) }))}
				/>
			{/each}
		</div>
	</section>
{/if}

<style>
	.signal-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.signal-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
