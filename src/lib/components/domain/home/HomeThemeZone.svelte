<!--
  SONE 3: Tema
  Tema-grid med 3-kolonne layout og onboarding-kort.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
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
		<div class="partner-onboarding-card partner-onboarding-card-theme">
			<p class="partner-onboarding-kicker">Felles start</p>
			<h3>Sett retning for parforholdet deres</h3>
			<p>
				Lag et eget tema for samliv, prioriteringer og ukerytme. Derfra kan dere bygge mål, samtaler og oppgaver sammen.
			</p>
			<div class="partner-onboarding-actions">
				{#if ctx.relationshipTheme}
					<button class="partner-onboarding-btn primary" onclick={() => goto(`/tema/${ctx.relationshipTheme!.id}`)}>Åpne partnertema</button>
				{:else}
					<button class="partner-onboarding-btn primary" onclick={ctx.openPartnerOnboardingChat}>Opprett partnertema</button>
				{/if}
				<button class="partner-onboarding-btn" onclick={() => goto('/samtaler')}>Åpne samtaler</button>
			</div>
		</div>
	{/if}
	{#if ctx.themes.length}
		<div class="tema-v3-grid">
			{#each ctx.themes.slice(0, 6) as theme}
				<button class="tema-btn-v3" style={getThemeHueStyle(theme.name)} onclick={() => { if (ctx.temaPressBlocked) return; startNavMetric('home', 'tema'); void goto(`/tema/${theme.id}`); }}>
					<span class="tema-btn-v3-icon">{theme.emoji}</span>
					<span class="tema-btn-v3-label">{theme.name}</span>
				</button>
			{/each}
		</div>
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
		padding: 6px 16px 4px;
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

	/* ── Tema v3: 3-kolonne grid med kompakte knapper ── */
	.tema-v3-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.tema-btn-v3 {
		--theme-hue: 228;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: hsl(var(--theme-hue) 19% 11%);
		border: none;
		border-radius: 14px;
		padding: 8px 6px;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
		font: inherit;
		color: #ddd;
	}

	.tema-btn-v3:hover {
		background: hsl(var(--theme-hue) 22% 14%);
		box-shadow: 0 8px 20px hsl(var(--theme-hue) 55% 18% / 0.2);
		transform: translateY(-1px);
	}

	.tema-btn-v3-icon {
		font-size: 1.15rem;
		line-height: 1;
		filter: drop-shadow(0 2px 8px hsl(var(--theme-hue) 70% 18% / 0.25));
	}

	.tema-btn-v3-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: hsl(var(--theme-hue) 22% 80%);
		opacity: 0.8;
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

	.partner-onboarding-card {
		width: 100%;
		padding: 14px;
		border-radius: 14px;
		background: linear-gradient(155deg, rgba(51, 86, 153, 0.24), rgba(25, 29, 40, 0.9));
		border: 1px solid rgba(130, 160, 255, 0.32);
		box-shadow: 0 14px 26px rgba(6, 8, 14, 0.28);
	}

	.partner-onboarding-card-theme {
		margin-bottom: 10px;
	}

	.partner-onboarding-kicker {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #9fb8ff;
	}

	.partner-onboarding-card h3 {
		margin: 6px 0 8px;
		font-size: 1rem;
		line-height: 1.3;
		color: #ecf2ff;
	}

	.partner-onboarding-card p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: #d2daee;
	}

	.partner-onboarding-actions {
		margin-top: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.partner-onboarding-btn {
		border: 1px solid rgba(180, 198, 240, 0.3);
		background: rgba(13, 16, 26, 0.6);
		color: #dce4f6;
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.partner-onboarding-btn.primary {
		background: linear-gradient(145deg, #5476ef, #4364d9);
		border-color: transparent;
		color: #fff;
	}
</style>
