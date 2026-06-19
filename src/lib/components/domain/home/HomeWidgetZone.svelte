<!--
  SONE 2: Widgets
  Paginert widget-grid med sjekklister, dynamiske widgets og skeleton-loading.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { getContext } from 'svelte';
	import DynamicWidget from '../../composed/DynamicWidget.svelte';
	import ChecklistWidget from '../../composed/ChecklistWidget.svelte';
	import PagerDots from '../../ui/PagerDots.svelte';
	import PartnerOnboardingCard from './PartnerOnboardingCard.svelte';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);

	const partnerActions = $derived([
		{ label: 'Start partner-onboarding', primary: true, onClick: ctx.openPartnerOnboardingChat },
		{ label: 'Åpne ukeplan sammen', onClick: () => goto('/ukeplan') }
	]);
</script>

{#if !ctx.inputExpanded}
	<section class="zone zone-widgets" aria-label="Sensor-oversikt" out:fly={{ y: -30, duration: 750 }} in:fly={{ y: -18, duration: 600 }}>
	<button
		class="widget-panel-fab"
		onclick={() => (ctx.widgetPanelOpen = !ctx.widgetPanelOpen)}
		aria-label="Administrer widgets"
		title="Administrer widgets"
	>
		+
	</button>

	<div class="widget-pager" bind:this={ctx.widgetPagerEl} onscroll={ctx.handleWidgetPagerScroll}>
		{#each ctx.homeWidgetPages as page, pageIndex (`page:${pageIndex}`)}
			<div class="widget-page" role="group" aria-label={`Widget-side ${pageIndex + 1} av ${ctx.homeWidgetPages.length}`}>
				<div class="widget-page-grid">
					{#each page as item, itemIndex (item.id)}
						{@const insertDivider =
							itemIndex > 0 &&
							page[itemIndex - 1]?.kind === 'checklist' &&
							item.kind !== 'checklist'}
						{#if insertDivider}
							<div class="widget-page-divider" aria-hidden="true"></div>
						{/if}

						{#if item.kind === 'checklist' && item.checklist}
							{@const isSynthetic = item.checklist.id.startsWith('synthetic:')}
							{@const isMonth = !!item.checklist.context?.startsWith('month:')}
							<ChecklistWidget
								checklist={item.checklist}
								monthDayData={isMonth ? ctx.monthDayData : undefined}
								onclick={isSynthetic ? undefined : () => (ctx.openChecklist = item.checklist!)}
								onplan={() => ctx.handleChecklistPlan(item.checklist?.context ?? null)}
								onremove={isSynthetic ? undefined : async () => {
									if (!item.checklist) return;
									await fetch(`/api/checklists/${item.checklist.id}`, { method: 'DELETE' });
									ctx.activeChecklists = ctx.activeChecklists.filter((c) => c.id !== item.checklist?.id);
								}}
							/>
						{:else if item.kind === 'skeleton'}
							<div class="widget-skeleton" style:animation-delay="{(item.skeletonIndex ?? 0) * 120}ms"></div>
						{:else if item.kind === 'dynamic' && item.widget}
							<DynamicWidget
								widgetId={item.widget.id}
								title={item.widget.title}
								unit={item.widget.unit}
								color={item.widget.color}
								pinned={item.widget.pinned}
								onpress={() => ctx.navigateForWidget(item.widget!)}
								onchat={(summary) => ctx.openChat(summary)}
								onunpin={() => ctx.unpinWidget(item.widget!.id)}
								onconfig={() => ctx.openWidgetConfigSheet(item.widget!)}
							/>
						{:else if item.kind === 'partner'}
							<PartnerOnboardingCard
								variant="widget"
								kicker="Partnermodus aktivert"
								title="Kom i gang sammen i stedet for tomme widgets"
								body="Start med en felles oppstartsplan for parforhold og samliv, så bygger vi widgets etter det som faktisk er viktig for dere."
								actions={partnerActions}
							/>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>

	{#if ctx.homeWidgetPages.length > 1}
		<PagerDots
			count={ctx.homeWidgetPages.length}
			active={ctx.currentWidgetPage}
			onSelect={(i) => ctx.goToWidgetPage(i)}
		/>
	{/if}

	</section>
{/if}

<style>
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	/* ── Widget-sone (28 %) — kort med avrundede hjørner ── */
	.zone-widgets {
		flex: 28 0 0;
		min-height: 0;
		padding: 8px 14px 4px;
		background: #171717;
		border-radius: 18px;
		margin: 0;
		position: relative;
	}

	/* ── Widget-pager ── */
	.widget-pager {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		height: 100%;
	}

	.widget-pager::-webkit-scrollbar {
		display: none;
	}

	.widget-page {
		flex: 0 0 100%;
		scroll-snap-align: start;
		min-width: 100%;
		padding-top: 6px;
	}

	.widget-page-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: center;
		align-content: flex-start;
		min-height: 100%;
		padding: 0 28px 4px 0;
		box-sizing: border-box;
	}

	.widget-page-divider {
		flex: 0 0 100%;
		height: 1px;
		background: #202020;
		margin: -2px 6px 2px;
	}


	.widget-panel-fab {
		position: absolute;
		right: 10px;
		bottom: 10px;
		z-index: 4;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid #3a3a3a;
		background: #101010;
		color: #d8d8d8;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
	}

	.widget-panel-fab:hover {
		border-color: #4a5af0;
		color: #ffffff;
	}

	/* ── Widget-skeleton (laster) ── */
	.widget-skeleton {
		width: 72px;
		height: 88px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.widget-skeleton::before {
		content: '';
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #1e1e1e;
		animation: skeleton-pulse 1.4s ease-in-out infinite;
	}

	.widget-skeleton::after {
		content: '';
		width: 40px;
		height: 8px;
		border-radius: 4px;
		background: #1e1e1e;
		animation: skeleton-pulse 1.4s ease-in-out infinite;
		animation-delay: inherit;
	}

	@keyframes skeleton-pulse {
		0%, 100% { background: #1e1e1e; }
		50%       { background: #2c2c2c; }
	}
</style>
