<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';

	interface Props {
		tree: FamilyDashboardData['tree'];
		onSelectPerson?: (personId: string) => void;
	}

	let { tree, onSelectPerson }: Props = $props();

	function group(kind: string) {
		return tree.byKind[kind] ?? [];
	}

	const partner = $derived(group('partner'));
	const children = $derived(group('child'));
	const parents = $derived(group('parent'));
	const inLaws = $derived(group('in_law'));
	const siblings = $derived(group('sibling'));
	const extended = $derived(group('extended_family'));
</script>

<div class="family-tree">
	<div class="row parents">
		{#each parents as person (person.id)}
			<button class="node parent" onclick={() => onSelectPerson?.(person.id)}>
				<span class="emoji">{person.avatarEmoji ?? '👵'}</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
		{#each inLaws as person (person.id)}
			<button class="node in-law" onclick={() => onSelectPerson?.(person.id)}>
				<span class="emoji">{person.avatarEmoji ?? '👨‍👩‍👧‍👦'}</span>
				<span class="name">{person.name}</span>
				<span class="kind-tag">sviger</span>
			</button>
		{/each}
	</div>

	<div class="row siblings">
		{#each siblings as person (person.id)}
			<button class="node sibling" onclick={() => onSelectPerson?.(person.id)}>
				<span class="emoji">{person.avatarEmoji ?? '👥'}</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
	</div>

	<div class="row self">
		<div class="node self">
			<span class="emoji">🙂</span>
			<span class="name">Meg</span>
		</div>
		{#each partner as person (person.id)}
			<button class="node partner" onclick={() => onSelectPerson?.(person.id)}>
				<span class="emoji">{person.avatarEmoji ?? '💞'}</span>
				<span class="name">{person.name}</span>
			</button>
		{/each}
	</div>

	{#if children.length}
		<div class="row children">
			{#each children as person (person.id)}
				<button class="node child" onclick={() => onSelectPerson?.(person.id)}>
					<span class="emoji">{person.avatarEmoji ?? '🧒'}</span>
					<span class="name">{person.name}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if extended.length}
		<div class="row extended">
			{#each extended as person (person.id)}
				<button class="node extended" onclick={() => onSelectPerson?.(person.id)}>
					<span class="emoji">{person.avatarEmoji ?? '🌳'}</span>
					<span class="name">{person.name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.family-tree {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--surface-2, #f5f5f7);
		border-radius: 12px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}
	.node {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: var(--surface-1, #fff);
		border: 1px solid var(--border, #e0e0e3);
		cursor: pointer;
		font: inherit;
		color: inherit;
		transition: transform 0.1s ease, box-shadow 0.1s ease;
	}
	.node:hover {
		transform: translateY(-1px);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
	}
	.node.self {
		background: linear-gradient(135deg, #7c8ef5, #6072e6);
		color: white;
		border: none;
		cursor: default;
	}
	.node.partner { border-color: #f5a3c5; }
	.node.child { border-color: #f7c873; }
	.node.parent { border-color: #c1d6f5; }
	.node.in-law { border-color: #d8b4fe; }
	.node.sibling { border-color: #b6e4cf; }
	.node.extended { border-color: #cbd5e1; }
	.emoji { font-size: 1.1rem; }
	.kind-tag {
		font-size: 0.7rem;
		opacity: 0.6;
		margin-left: 0.25rem;
	}
</style>
