<!--
  SONE 3: Tema
  Sideveis sveipbar tema-pager med snap: seks tema per side.
  Side 1 = de seks prioriterte standard-temaene (sorteringsrekkefølge fra
  langpress-lista); ferier/reiser og prosjekter får egne sider til slutt.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import PagerDots from '../../ui/PagerDots.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';
	import { HOME_CTX, type HomeContext } from './home-context';
	import { buildThemePages } from './home-theme-pages';
	import ThemeButtonGrid from './ThemeButtonGrid.svelte';
	import PartnerOnboardingCard from './PartnerOnboardingCard.svelte';

	const ctx = getContext<HomeContext>(HOME_CTX);

	const partnerActions = $derived([
		ctx.relationshipTheme
			? { label: 'Åpne partnertema', primary: true, onClick: () => goto(`/tema/${ctx.relationshipTheme!.id}`) }
			: { label: 'Opprett partnertema', primary: true, onClick: ctx.openPartnerOnboardingChat },
		{ label: 'Åpne samtaler', onClick: () => goto('/samtaler') }
	]);

	// ── Tema-pager ──
	const themePages = $derived(buildThemePages(ctx.themes));
	let pagerEl = $state<HTMLElement | null>(null);
	let currentPage = $state(0);

	$effect(() => {
		const total = themePages.length;
		if (total === 0) { currentPage = 0; return; }
		if (currentPage > total - 1) currentPage = total - 1;
	});

	const zoneLabel = $derived(themePages[currentPage]?.label ?? 'Temaer');

	function handlePagerScroll() {
		if (!pagerEl) return;
		const width = pagerEl.clientWidth;
		if (width <= 0) return;
		currentPage = Math.round(pagerEl.scrollLeft / width);
	}

	function goToPage(index: number) {
		if (!pagerEl) return;
		const clamped = Math.max(0, Math.min(index, themePages.length - 1));
		pagerEl.scrollTo({ left: clamped * pagerEl.clientWidth, behavior: 'smooth' });
		currentPage = clamped;
	}

	function selectTheme(theme: { id: string }) {
		if (ctx.temaPressBlocked) return;
		startNavMetric('home', 'tema');
		void goto(`/tema/${theme.id}`);
	}
</script>

{#if !ctx.inputExpanded}
	<section
		class="zone zone-tema"
		class:has-pager-dots={themePages.length > 1}
		aria-label="Temaer"
		out:fly={{ y: -34, duration: 750 }}
		in:fly={{ y: -22, duration: 600 }}
		onpointerdown={ctx.handleTemaPressStart}
		onpointerup={ctx.handleTemaPressEnd}
		onpointerleave={ctx.handleTemaPressEnd}
		onpointercancel={ctx.handleTemaPressEnd}
	>
	<p class="zone-label">{zoneLabel}</p>
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
		<div class="tema-pager" bind:this={pagerEl} onscroll={handlePagerScroll}>
			{#each themePages as page, pageIndex (page.key)}
				<div class="tema-page" role="group" aria-label={`${page.label} — side ${pageIndex + 1} av ${themePages.length}`}>
					<ThemeButtonGrid themes={page.themes} onSelect={selectTheme} />
				</div>
			{/each}
		</div>
		{#if themePages.length > 1}
			<PagerDots count={themePages.length} active={currentPage} onSelect={goToPage} ariaLabel="Tema-sider" />
		{/if}
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
		display: flex;
		flex-direction: column;
		padding: 6px 0 4px;
		position: relative;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.zone-tema.has-pager-dots {
		padding-bottom: 22px;
	}

	/* ── Zone-label ── */
	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 6px;
	}

	/* ── Tema-pager (sveip + snap, seks tema per side) ── */
	.tema-pager {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.tema-pager::-webkit-scrollbar {
		display: none;
	}

	.tema-page {
		flex: 0 0 100%;
		min-width: 100%;
		height: 100%;
		scroll-snap-align: start;
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
