<script lang="ts">
	import { slide } from 'svelte/transition';
	import ChecklistCheckbox from './ChecklistCheckbox.svelte';
	import TaskTitle from './TaskTitle.svelte';

	interface RoutineItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		estimateMinutes: number | null;
	}

	interface Props {
		routine: {
			checklistId: string;
			title: string;
			emoji: string;
			items: RoutineItem[];
		};
		expanded: boolean;
		ontoggleexpand: () => void;
		ontoggleitem: (checklistId: string, itemId: string, newChecked: boolean) => void;
	}

	let { routine, expanded, ontoggleexpand, ontoggleitem }: Props = $props();

	let doneCount = $derived(routine.items.filter(i => i.checked).length);
	let totalCount = $derived(routine.items.length);
	let cR = 8;
	let cC = $derived(2 * Math.PI * cR);
	let cPct = $derived(totalCount > 0 ? doneCount / totalCount : 0);
</script>

<div class="rg-wrapper">
	<div class="rg-header">
		<button
			type="button"
			class="rg-caret"
			class:rg-caret-expanded={expanded}
			onclick={ontoggleexpand}
			aria-label={expanded ? 'Lukk rutine' : 'Utvid rutine'}
		>▸</button>
		<button class="rg-title-btn" onclick={ontoggleexpand}>
			<span class="rg-emoji">{routine.emoji}</span>
			<span class="rg-title">{routine.title}</span>
		</button>
		<svg class="rg-ring" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
			<circle cx="10" cy="10" r={cR} fill="none" stroke="#2a2a2a" stroke-width="2.5"/>
			<circle cx="10" cy="10" r={cR} fill="none"
				stroke={doneCount === totalCount && totalCount > 0 ? '#5fa080' : '#7c8ef5'}
				stroke-width="2.5"
				stroke-dasharray="{cPct * cC} {cC}"
				stroke-linecap="round"
				transform="rotate(-90 10 10)"
			/>
		</svg>
	</div>

	{#if expanded}
		<div class="rg-children" transition:slide>
			{#each routine.items as item (item.id)}
				<div class="rg-child" class:rg-child-checked={item.checked}>
					<span class="rg-child-text"><TaskTitle title={item.text} /></span>
					<ChecklistCheckbox
						checked={item.checked}
						size="sm"
						onclick={() => ontoggleitem(routine.checklistId, item.id, !item.checked)}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.rg-wrapper {
		display: flex;
		flex-direction: column;
	}

	.rg-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 0 2px;
	}

	.rg-caret {
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		color: #7c8ef5;
		font-size: 0.9rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: transform 0.2s;
		padding: 0;
		line-height: 1;
	}

	.rg-caret:hover { color: #9cb0ff; }
	.rg-caret-expanded { transform: rotate(90deg); }

	.rg-title-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 8px 0;
		border: none;
		background: transparent;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.rg-emoji {
		font-size: 0.95rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.rg-title {
		font-size: 0.88rem;
		color: #ccc;
		font-weight: 600;
	}

	.rg-ring {
		flex-shrink: 0;
		display: block;
		margin-right: 12px;
	}

	.rg-children {
		display: flex;
		flex-direction: column;
		padding: 0 12px 0 32px;
		background: #0a0a0a;
		border-radius: 0 0 10px 10px;
		margin-bottom: 4px;
	}

	.rg-child {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 0;
		border-bottom: 1px solid #1a1a1a;
	}

	.rg-child:last-child { border-bottom: none; }

	.rg-child-text {
		font-size: 0.78rem;
		color: #aaa;
		line-height: 1.3;
		flex: 1;
	}

	.rg-child-checked .rg-child-text {
		color: #555;
		text-decoration: line-through;
	}
</style>
