<!--
  Action-pill-raden for hjemskjermen: ChipStrip med pills (ikon + label + valgfri verdi).
  Ren presentasjonskomponent — trukket ut fra HomeChatZone, markup og CSS uendret.
  Generisk over pill-typen slik at sonen kan sende sine egne ActionItem-objekter
  og få dem tilbake i callbacks.
-->
<script lang="ts" generics="T extends ActionPillItem">
	import ChipStrip from '../../ui/ChipStrip.svelte';
	import type { ActionPillItem } from './action-pill-types';

	interface Props {
		items: T[];
		onItemClick: (item: T) => void;
		onItemPressStart?: (item: T, e: PointerEvent) => void;
		onItemPressEnd?: () => void;
		onItemDismiss?: (item: T) => void;
		ariaLabel?: string;
	}

	let { items, onItemClick, onItemPressStart, onItemPressEnd, onItemDismiss, ariaLabel = 'Foreslåtte handlinger' }: Props = $props();
</script>

<ChipStrip gap={8} {ariaLabel}>
	{#each items as item (item.id)}
		{#if item.dismissable && onItemDismiss}
			<span class="action-pill-group">
				<button
					class="action-pill action-pill-grouped"
					class:is-done={item.done}
					onclick={() => onItemClick(item)}
					onpointerdown={(e) => onItemPressStart?.(item, e)}
					onpointerup={() => onItemPressEnd?.()}
					onpointercancel={() => onItemPressEnd?.()}
					onpointerleave={() => onItemPressEnd?.()}
					oncontextmenu={(e) => e.preventDefault()}
				>
					<span class="action-pill-icon">{item.icon}</span>
					<span class="action-pill-label">{item.label}</span>
					{#if item.value !== undefined}
						<span class="action-pill-val">{item.value}</span>
					{/if}
				</button>
				<button class="action-pill-dismiss" aria-label="Avvis {item.label}" onclick={() => onItemDismiss(item)}
					>×</button
				>
			</span>
		{:else}
			<button
				class="action-pill"
				class:is-done={item.done}
				onclick={() => onItemClick(item)}
				onpointerdown={(e) => onItemPressStart?.(item, e)}
				onpointerup={() => onItemPressEnd?.()}
				onpointercancel={() => onItemPressEnd?.()}
				onpointerleave={() => onItemPressEnd?.()}
				oncontextmenu={(e) => e.preventDefault()}
			>
				<span class="action-pill-icon">{item.icon}</span>
				<span class="action-pill-label">{item.label}</span>
				{#if item.value !== undefined}
					<span class="action-pill-val">{item.value}</span>
				{/if}
			</button>
		{/if}
	{/each}
</ChipStrip>

<style>
	.action-pill { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; background: hsl(228 19% 11%); border: 1px solid hsl(228 16% 18%); border-radius: 999px; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; padding: 8px 14px; cursor: pointer; font: inherit; color: hsl(228 22% 80%); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; transition: background 0.15s, border-color 0.15s, transform 0.15s; }
	.action-pill:hover { background: hsl(228 22% 14%); border-color: hsl(228 28% 34%); transform: translateY(-1px); }
	.action-pill.is-done { opacity: 0.7; }
	.action-pill-icon { font-size: 0.95rem; line-height: 1; }
	.action-pill-val { margin-left: 6px; padding: 2px 7px; background: hsl(228 28% 22%); border-radius: 999px; color: #e2e8f0; font-weight: 700; }

	/* Pill med avvis-knapp: holdes sammen i strømmen og deler venstre-kant. */
	.action-pill-group { flex: 0 0 auto; display: inline-flex; align-items: stretch; }
	.action-pill-grouped { border-top-right-radius: 0; border-bottom-right-radius: 0; }
	.action-pill-dismiss {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		background: hsl(228 19% 11%);
		border: 1px solid hsl(228 16% 18%);
		border-left: none;
		border-radius: 0 999px 999px 0;
		color: hsl(228 18% 60%);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.action-pill-dismiss:hover { background: hsl(228 22% 14%); color: hsl(8 70% 70%); }
</style>
