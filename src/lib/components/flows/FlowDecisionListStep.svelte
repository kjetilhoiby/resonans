<script lang="ts">
	interface OpenItem {
		id: string;
		text: string;
	}

	interface Props {
		openItems: OpenItem[];
		decisions: Record<string, 'carryover' | 'unsolved'>;
		carryoverCount: number;
		onToggle: (id: string) => void;
	}

	let { openItems, decisions, carryoverCount, onToggle }: Props = $props();
</script>

{#if openItems.length === 0}
	<p class="fs-empty">Alle oppgaver er fullført 🎉</p>
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
</style>
