<!--
  KebabMenu — generisk «•••»-meny for header-handlinger.

  I motsetning til ConversationContextMenu (som er bundet til handlinger på én samtale
  i listevisningen) er denne datadrevet: den viser en liste av valg og melder fra hvilket
  som ble valgt. Brukes bl.a. i chat-headeren (søk/kalender/stjernemerkede).
-->
<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';

	export interface KebabMenuItem {
		id: string;
		label: string;
		icon?: IconName;
	}

	interface Props {
		items: KebabMenuItem[];
		onSelect: (id: string) => void;
		ariaLabel?: string;
		/** data-track for brukslogging, f.eks. «samtale-chat:meny». */
		track?: string;
		/** Start med menyen åpen (brukes av /design for statisk demo). */
		initialOpen?: boolean;
	}

	let { items, onSelect, ariaLabel = 'Flere handlinger', track, initialOpen = false }: Props = $props();

	let open = $state(initialOpen);
	let menuEl: HTMLDivElement | undefined = $state();

	function handleWindowPointerDown(e: PointerEvent) {
		if (menuEl && !menuEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function select(id: string) {
		open = false;
		onSelect(id);
	}
</script>

<svelte:window onpointerdown={open ? handleWindowPointerDown : undefined} />

<div class="ctx-wrap" bind:this={menuEl}>
	<button
		class="ctx-trigger"
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
		}}
		aria-label={ariaLabel}
		title={ariaLabel}
		data-track={track}
	>
		<Icon name="kebab" size={18} />
	</button>

	{#if open}
		<div class="ctx-menu" role="menu">
			{#each items as item (item.id)}
				<button class="ctx-item" role="menuitem" onclick={() => select(item.id)}>
					{#if item.icon}
						<span class="ctx-icon"><Icon name={item.icon} size={15} /></span>
					{/if}
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.ctx-wrap {
		position: relative;
		display: inline-flex;
	}

	.ctx-trigger {
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		padding: 0.25rem 0.4rem;
		border-radius: 6px;
		color: var(--text-secondary, #6f6f6f);
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ctx-trigger:hover {
		background: #171717;
		border-color: #262626;
		color: #cfcfcf;
	}

	.ctx-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		background: #141414;
		border: 1px solid #252525;
		border-radius: 10px;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.42);
		min-width: 180px;
		z-index: 100;
		overflow: hidden;
		padding: 4px;
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		font-size: 0.875rem;
		color: #d6d6d6;
		border-radius: 6px;
		white-space: nowrap;
	}

	.ctx-item:hover {
		background: #202020;
	}

	.ctx-icon {
		display: inline-flex;
		color: #8e8e8e;
	}
</style>
