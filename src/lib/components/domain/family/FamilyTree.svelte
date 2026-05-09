<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';

	type TreePerson = FamilyDashboardData['tree']['nodes'][number];

	interface Props {
		tree: FamilyDashboardData['tree'];
		onSelectPerson?: (personId: string) => void;
	}

	let { tree, onSelectPerson }: Props = $props();

	interface FamilyUnit {
		primary: TreePerson;
		partner: TreePerson | null;
		children: TreePerson[];
	}

	function findPerson(id: string): TreePerson | null {
		return tree.nodes.find((p) => p.id === id) ?? null;
	}

	function findPartnerOf(personId: string): TreePerson | null {
		const edge = tree.edges.find(
			(e) =>
				(e.subType === 'married_to' || e.subType === 'partnered_with') &&
				(e.fromPersonId === personId || e.toPersonId === personId)
		);
		if (!edge) return null;
		const otherId = edge.fromPersonId === personId ? edge.toPersonId : (edge.fromPersonId ?? null);
		return otherId ? findPerson(otherId) : null;
	}

	function findChildrenOf(personId: string): TreePerson[] {
		return tree.edges
			.filter((e) => e.subType === 'parent_of' && e.fromPersonId === personId)
			.map((e) => findPerson(e.toPersonId))
			.filter((p): p is TreePerson => p !== null);
	}

	// Self: partner via null-origin edge, children from byKind.child
	const selfPartner = $derived((() => {
		const edge = tree.edges.find(
			(e) =>
				e.fromPersonId === null &&
				(e.subType === 'married_to' || e.subType === 'partnered_with')
		);
		return edge ? findPerson(edge.toPersonId) : (tree.byKind['partner']?.[0] ?? null);
	})());

	const selfChildren = $derived(tree.byKind['child'] ?? []);
	const parents = $derived(tree.byKind['parent'] ?? []);

	// Build sibling units; avoid including persons already used as self-partner
	const selfPartnerId = $derived(selfPartner?.id ?? null);

	const siblingUnits = $derived((() => {
		const allCandidates = [
			...(tree.byKind['sibling'] ?? []),
			...(tree.byKind['in_law'] ?? [])
		];

		const units: FamilyUnit[] = [];
		const claimed = new Set<string>(selfPartnerId ? [selfPartnerId] : []);

		for (const person of allCandidates) {
			if (claimed.has(person.id)) continue;
			const partner = findPartnerOf(person.id);
			if (partner) claimed.add(partner.id);

			const childrenA = findChildrenOf(person.id);
			const childrenB = partner ? findChildrenOf(partner.id) : [];
			const seen = new Set(childrenA.map((c) => c.id));
			const children = [...childrenA, ...childrenB.filter((c) => !seen.has(c.id))];

			units.push({ primary: person, partner, children });
		}
		return units;
	})());

	// Extended family not already shown as a sibling child
	const linkedIds = $derived(
		new Set(siblingUnits.flatMap((u) => u.children.map((c) => c.id)))
	);
	const standaloneExtended = $derived(
		(tree.byKind['extended_family'] ?? []).filter((p) => !linkedIds.has(p.id))
	);
</script>

<div class="family-tree">
	<!-- Generation 0: parents -->
	{#if parents.length}
		<div class="gen parents-row">
			{#each parents as p (p.id)}
				<button class="node parent" onclick={() => onSelectPerson?.(p.id)}>
					<span class="avatar">{p.avatarEmoji ?? '👵'}</span>
					<span class="name">{p.name}</span>
				</button>
			{/each}
		</div>
		<div class="connector-row">
			<div class="line-v"></div>
		</div>
	{/if}

	<!-- Generation 1: self + sibling branches side by side -->
	<div class="gen branches-row">
		<!-- Self branch -->
		<div class="branch">
			<div class="couple-row">
				<div class="node self">
					<span class="avatar">🙂</span>
					<span class="name">Meg</span>
				</div>
				{#if selfPartner}
					<span class="heart">♥</span>
					<button class="node partner" onclick={() => onSelectPerson?.(selfPartner.id)}>
						<span class="avatar">{selfPartner.avatarEmoji ?? '💞'}</span>
						<span class="name">{selfPartner.name}</span>
					</button>
				{/if}
			</div>
			{#if selfChildren.length}
				<div class="branch-children">
					{#each selfChildren as c (c.id)}
						<button class="node child" onclick={() => onSelectPerson?.(c.id)}>
							<span class="avatar">{c.avatarEmoji ?? '🧒'}</span>
							<span class="name">{c.name}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Sibling branches -->
		{#each siblingUnits as unit (unit.primary.id)}
			<div class="branch">
				<div class="couple-row">
					<button class="node sibling" onclick={() => onSelectPerson?.(unit.primary.id)}>
						<span class="avatar">{unit.primary.avatarEmoji ?? '👥'}</span>
						<span class="name">{unit.primary.name}</span>
					</button>
					{#if unit.partner}
						<span class="heart">♥</span>
						<button class="node in-law" onclick={() => onSelectPerson?.(unit.partner.id)}>
							<span class="avatar">{unit.partner.avatarEmoji ?? '👤'}</span>
							<span class="name">{unit.partner.name}</span>
						</button>
					{/if}
				</div>
				{#if unit.children.length}
					<div class="branch-children">
						{#each unit.children as c (c.id)}
							<button class="node extended" onclick={() => onSelectPerson?.(c.id)}>
								<span class="avatar">{c.avatarEmoji ?? '🌳'}</span>
								<span class="name">{c.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Standalone extended family not attached to any branch -->
	{#if standaloneExtended.length}
		<div class="gen extended-row">
			{#each standaloneExtended as p (p.id)}
				<button class="node extended" onclick={() => onSelectPerson?.(p.id)}>
					<span class="avatar">{p.avatarEmoji ?? '🌳'}</span>
					<span class="name">{p.name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.family-tree {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		padding: 1.25rem 1rem 1rem;
		background: #141414;
		border-radius: 14px;
		color: #d0d0d0;
	}

	.gen {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		width: 100%;
	}

	.parents-row {
		flex-wrap: wrap;
	}

	.connector-row {
		display: flex;
		justify-content: center;
		height: 20px;
	}
	.line-v {
		width: 1px;
		height: 100%;
		background: #333;
	}

	/* Side-by-side branches */
	.branches-row {
		gap: 1.25rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.branch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.couple-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.heart {
		font-size: 0.75rem;
		color: #f5a3c5;
		line-height: 1;
	}

	.branch-children {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.extended-row {
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	/* Nodes */
	.node {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border-radius: 999px;
		border: 1px solid #2e2e2e;
		background: #1e1e1e;
		color: #c8c8c8;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
		white-space: nowrap;
	}

	.node:hover {
		background: #272727;
		border-color: #444;
		color: #fff;
	}

	.node.self {
		background: linear-gradient(135deg, #5a6de8, #4a5ad4);
		border-color: transparent;
		color: #fff;
		cursor: default;
	}

	.node.partner  { border-color: #7a3f55; }
	.node.child    { border-color: #7a6030; }
	.node.parent   { border-color: #3a5070; }
	.node.sibling  { border-color: #2e5040; }
	.node.in-law   { border-color: #5a3a7a; }
	.node.extended { border-color: #2e3a4a; }

	.avatar { font-size: 1rem; line-height: 1; }
	.name   { font-size: 0.82rem; }
</style>
