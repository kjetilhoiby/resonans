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

	const partner   = $derived(group('partner'));
	const children  = $derived(group('child'));
	const parents   = $derived(group('parent'));
	const inLaws    = $derived(group('in_law'));
	const siblings  = $derived(group('sibling'));
	const extended  = $derived(group('extended_family'));
	const friends   = $derived(group('friend'));

	const hasSiblings = $derived(siblings.length > 0);
	const hasChildren = $derived(children.length > 0);
	const hasParents  = $derived(parents.length > 0);
	const hasExtended = $derived(inLaws.length > 0 || extended.length > 0 || friends.length > 0);
</script>

<div class="tree">

	<!-- Gen 1: Foreldre -->
	{#if hasParents}
		<div class="gen parents-row">
			<div class="couple">
				{#each parents as person, i (person.id)}
					{#if i > 0}<span class="couple-bar"></span>{/if}
					<button class="node parent" onclick={() => onSelectPerson?.(person.id)}>
						<span class="emoji">{person.avatarEmoji ?? '👴'}</span>
						<span class="name">{person.name}</span>
					</button>
				{/each}
			</div>
		</div>
		<div class="v-line"></div>
	{/if}

	<!-- Gen 2: Søsken-gren + Meg + Partner -->
	{#if hasSiblings}
		<div class="gen2-split">
			<!-- Venstre gren: søsken -->
			<div class="split-branch left-branch">
				<div class="branch-nodes">
					{#each siblings as person (person.id)}
						<button class="node sibling" onclick={() => onSelectPerson?.(person.id)}>
							<span class="emoji">{person.avatarEmoji ?? '👥'}</span>
							<span class="name">{person.name}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Høyre gren: Meg + partner + barn -->
			<div class="split-branch right-branch">
				<div class="self-couple">
					<div class="node self">
						<span class="emoji">🙂</span>
						<span class="name">Meg</span>
					</div>
					{#each partner as person (person.id)}
						<span class="couple-bar"></span>
						<button class="node partner" onclick={() => onSelectPerson?.(person.id)}>
							<span class="emoji">{person.avatarEmoji ?? '💞'}</span>
							<span class="name">{person.name}</span>
						</button>
					{/each}
				</div>
				{#if hasChildren}
					<div class="v-line"></div>
					<div class="children-row">
						{#each children as person (person.id)}
							<button class="node child" onclick={() => onSelectPerson?.(person.id)}>
								<span class="emoji">{person.avatarEmoji ?? '🧒'}</span>
								<span class="name">{person.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- Ingen søsken: Meg + partner sentrert -->
		<div class="gen self-row">
			<div class="couple">
				<div class="node self">
					<span class="emoji">🙂</span>
					<span class="name">Meg</span>
				</div>
				{#each partner as person (person.id)}
					<span class="couple-bar"></span>
					<button class="node partner" onclick={() => onSelectPerson?.(person.id)}>
						<span class="emoji">{person.avatarEmoji ?? '💞'}</span>
						<span class="name">{person.name}</span>
					</button>
				{/each}
			</div>
		</div>
		{#if hasChildren}
			<div class="v-line"></div>
			<div class="gen children-row">
				{#each children as person (person.id)}
					<button class="node child" onclick={() => onSelectPerson?.(person.id)}>
						<span class="emoji">{person.avatarEmoji ?? '🧒'}</span>
						<span class="name">{person.name}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Svigerfamilie, venner og øvrige -->
	{#if hasExtended}
		<div class="extended-row">
			{#each inLaws as person (person.id)}
				<button class="node in-law" onclick={() => onSelectPerson?.(person.id)}>
					<span class="emoji">{person.avatarEmoji ?? '👨‍👩‍👧‍👦'}</span>
					<span class="name">{person.name}</span>
					<span class="kind-tag">sviger</span>
				</button>
			{/each}
			{#each extended as person (person.id)}
				<button class="node extended" onclick={() => onSelectPerson?.(person.id)}>
					<span class="emoji">{person.avatarEmoji ?? '🌳'}</span>
					<span class="name">{person.name}</span>
				</button>
			{/each}
			{#each friends as person (person.id)}
				<button class="node friend" onclick={() => onSelectPerson?.(person.id)}>
					<span class="emoji">{person.avatarEmoji ?? '👫'}</span>
					<span class="name">{person.name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	:root {
		--tree-line: #3a3a5c;
		--tree-bg: #0d0d1a;
		--node-bg: #16162a;
		--node-text: #dde1f0;
	}

	.tree {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		padding: 1.5rem 1.25rem 1.25rem;
		background: var(--tree-bg);
		border-radius: 14px;
		color: var(--node-text);
		min-width: 0;
	}

	/* ---- Koblingslinjer ---- */
	.v-line {
		width: 2px;
		height: 1.75rem;
		background: var(--tree-line);
		flex-shrink: 0;
	}

	.couple-bar {
		display: block;
		width: 1.25rem;
		height: 2px;
		background: var(--tree-line);
		flex-shrink: 0;
	}

	/* ---- Generasjonsrader ---- */
	.gen {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.couple {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* ---- Todelt rad for søsken-gren + Meg-gren ---- */
	.gen2-split {
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}

	/* Venstre gren (søsken): top-border + right-border → høyre halvdel av U-buen */
	.left-branch {
		border-top: 2px solid var(--tree-line);
		border-right: 2px solid var(--tree-line);
		padding: 1.5rem 1.75rem 0 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	/* Høyre gren (Meg): top-border + left-border → venstre halvdel av U-buen */
	.right-branch {
		border-top: 2px solid var(--tree-line);
		border-left: 2px solid var(--tree-line);
		padding: 1.5rem 0.75rem 0 1.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.branch-nodes {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.self-couple {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.children-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	/* ---- Noder ---- */
	.node {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		background: var(--node-bg);
		border: 1.5px solid #2c2c4a;
		cursor: pointer;
		font: inherit;
		color: var(--node-text);
		transition: transform 0.12s ease, box-shadow 0.12s ease;
		white-space: nowrap;
	}

	.node:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	}

	.node.self {
		background: linear-gradient(135deg, #7c8ef5, #5f6fe0);
		color: #fff;
		border: none;
		cursor: default;
		font-weight: 600;
	}

	.node.partner  { border-color: #a0405f; }
	.node.child    { border-color: #9a6520; }
	.node.parent   { border-color: #335f99; }
	.node.in-law   { border-color: #5f3a99; }
	.node.sibling  { border-color: #236b4a; }
	.node.friend   { border-color: #2a6a7a; }
	.node.extended { border-color: #3a3a5c; }

	.emoji { font-size: 1.05rem; }

	.kind-tag {
		font-size: 0.68rem;
		opacity: 0.45;
		margin-left: 0.15rem;
	}

	/* ---- Nedre rad: svigerfamilie/venner ---- */
	.extended-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px dashed #2a2a44;
		width: 100%;
	}
</style>
