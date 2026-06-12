<!--
  SONE 3: Tema
  Tema-grid med 3-kolonne layout og onboarding-kort.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { HOME_CTX, type HomeContext } from './home-context';
	import ThemeButtonGrid from './ThemeButtonGrid.svelte';
	import PartnerOnboardingCard from './PartnerOnboardingCard.svelte';

	const ctx = getContext<HomeContext>(HOME_CTX);

	const partnerActions = $derived([
		ctx.relationshipTheme
			? { label: 'Åpne partnertema', primary: true, onClick: () => goto(`/tema/${ctx.relationshipTheme!.id}`) }
			: { label: 'Opprett partnertema', primary: true, onClick: ctx.openPartnerOnboardingChat },
		{ label: 'Åpne samtaler', onClick: () => goto('/samtaler') }
	]);
</script>

{#if !ctx.inputExpanded}
	<section
		class="zone zone-tema"
		aria-label="Temaer"
		out:fly={{ y: -34, duration: 750 }}
		in:fly={{ y: -22, duration: 600 }}
		onpointerdown={ctx.handleTemaPressStart}
		onpointerup={ctx.handleTemaPressEnd}
		onpointerleave={ctx.handleTemaPressEnd}
		onpointercancel={ctx.handleTemaPressEnd}
	>
	<p class="zone-label">Temaer</p>
	{#if ctx.relationshipOnboardingActive}
		<PartnerOnboardingCard
			variant="theme"
			kicker="Felles start"
			title="Sett retning for parforholdet deres"
			body="Lag et eget tema for samliv, prioriteringer og ukerytme. Derfra kan dere bygge mål, samtaler og oppgaver sammen."
			actions={partnerActions}
		/>
	{/if}
	{#if ctx.themes.length}
		<ThemeButtonGrid
			themes={ctx.themes.slice(0, 6)}
			onSelect={(theme) => { if (ctx.temaPressBlocked) return; startNavMetric('home', 'tema'); void goto(`/tema/${theme.id}`); }}
		/>
	{:else}
		<button class="onboarding-cta" onclick={() => ctx.openChat('Jeg vil sette opp mitt første tema. Hjelp meg å definere hva jeg ønsker å fokusere på.')}>
		<span class="cta-icon"><Icon name="goals" size={18} /></span>
		<span class="cta-text">Kom i gang med temaer</span>
		<span class="cta-arrow">→</span>
	</button>
	{/if}
	</section>
{/if}

<style>
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	/* ── Tema-sone (24 %) ── */
	.zone-tema {
		flex: 24 0 0;
		min-height: 0;
		padding: 6px 0 4px;
		position: relative;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	/* ── Zone-label ── */
	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 6px;
	}

	.onboarding-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
		width: 100%;
		color: #888;
		font-size: 0.82rem;
		transition: background 0.15s, border-color 0.15s;
	}

	.onboarding-cta:hover {
		background: #222;
		border-color: #4a5af0;
		color: #aaa;
	}

	.cta-icon {
		color: #4a5af0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.cta-text {
		flex: 1;
		text-align: left;
	}

	.cta-arrow {
		color: #555;
	}
</style>
