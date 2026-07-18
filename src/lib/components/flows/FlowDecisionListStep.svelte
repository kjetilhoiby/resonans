<script lang="ts">
	interface OpenItem {
		id: string;
		text: string;
	}

	interface DecisionOption {
		value: string;
		label: string;
	}

	interface Props {
		openItems: OpenItem[];
		decisions: Record<string, string>;
		carryoverCount: number;
		/** Egne valg per punkt (chips). Uten denne: binær →/×-veksling. */
		options?: DecisionOption[];
		onToggle: (id: string) => void;
		onSelect?: (id: string, value: string) => void;
	}

	let { openItems, decisions, carryoverCount, options, onToggle, onSelect }: Props = $props();
</script>

{#if openItems.length === 0}
	<p class="fs-empty">Alle oppgaver er fullført 🎉</p>
{:else if options && options.length > 0}
	<ul class="fs-decision-list">
		{#each openItems as item (item.id)}
			<li class="fs-dec-row">
				<span class="fs-dec-row-text">{item.text}</span>
				<div class="fs-dec-chips" role="group" aria-label={`Plassering for ${item.text}`}>
					{#each options as opt (opt.value)}
						<button
							type="button"
							class="fs-dec-chip"
							class:active={decisions[item.id] === opt.value}
							onclick={() => onSelect?.(item.id, opt.value)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p class="fs-hint">Trykk for å veksle. Pil = ta med til neste dag, × = la stå.</p>
	<ul class="fs-decision-list">
		{#each openItems as item (item.id)}
			{@const isCarryover = decisions[item.id] === 'carryover'}
			<li>
				<button
					type="button"
					class="fs-dec-item"
					class:carryover={isCarryover}
					onclick={() => onToggle(item.id)}
				>
					<span class="fs-dec-text">{item.text}</span>
					<span class="fs-dec-action">{isCarryover ? '→' : '×'}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if carryoverCount > 0}
		<p class="fs-carry-note">{carryoverCount} punkt{carryoverCount === 1 ? '' : 'er'} flyttes til neste dag</p>
	{/if}
{/if}

<style>
	.fs-empty {
		font-size: 1rem;
		color: #7a9a7a;
		text-align: center;
		padding: 12px 0;
		margin: 0;
	}
	.fs-hint {
		font-size: 0.8rem;
		color: #3a3a4a;
		margin: 0;
	}
	.fs-decision-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
	.fs-dec-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 14px;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		color: #555;
		transition: all 0.1s;
	}
	.fs-dec-item.carryover { background: #0d1828; border-color: #2a4080; color: #c8d4ef; }
	.fs-dec-text { flex: 1; font-size: 0.9rem; line-height: 1.4; }
	.fs-dec-action { font-size: 1rem; font-weight: 700; width: 22px; text-align: center; flex-shrink: 0; opacity: 0.7; }
	.fs-dec-item.carryover .fs-dec-action { color: #4b6ef5; opacity: 1; }
	.fs-carry-note { font-size: 0.8rem; color: #4a5a8a; margin: 0; }

	/* Chips-variant: ett punkt per rad med valg under */
	.fs-dec-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px 14px;
		background: #141414;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}
	.fs-dec-row-text { font-size: 0.9rem; line-height: 1.4; color: #c8cddb; }
	.fs-dec-chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.fs-dec-chip {
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid #2a2a2e;
		background: transparent;
		color: #8a8fa0;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		transition: border-color 0.1s, color 0.1s, background 0.1s;
		white-space: nowrap;
	}
	.fs-dec-chip.active {
		background: #0d1828;
		border-color: #2a4080;
		color: #c8d4ef;
	}
</style>
