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
	const friends = $derived(tree.byKind['friend'] ?? []);
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

	const linkedIds = $derived(
		new Set(siblingUnits.flatMap((u) => u.children.map((c) => c.id)))
	);
	const standaloneExtended = $derived(
		[
			...(tree.byKind['extended_family'] ?? []).filter((p) => !linkedIds.has(p.id)),
			...friends
		]
	);
</script>

{#snippet avatar(p: TreePerson | { avatarEmoji: string | null; photoUrl?: string | null; name: string }, fallback: string)}
	{#if p.photoUrl}
		<img class="avatar-photo" src={p.photoUrl} alt={p.name} />
	{:else}
		<span class="emoji">{p.avatarEmoji ?? fallback}</span>
	{/if}
{/snippet}

<div class="family-tree">
	<!-- Foreldre -->
	{#if parents.length}
		<div class="gen parents-row">
			{#each parents as p, i (p.id)}
				{#if i > 0}<span class="couple-bar"></span>{/if}
				<button class="node parent" onclick={() => onSelectPerson?.(p.id)}>
					{@render avatar(p, '👵')}
					<span class="name">{p.name}</span>
				</button>
			{/each}
		</div>
		<div class="v-line"></div>
	{/if}

	<!-- Grener: søskenenheter + Meg -->
	<div class="gen branches-row">
		<!-- Meg-grenen -->
		<div class="branch">
			<div class="couple-row">
				<div class="node self">
					<span class="emoji">🙂</span>
					<span class="name">Meg</span>
				</div>
				{#if selfPartner}
					<span class="couple-bar"></span>
					<button class="node partner" onclick={() => onSelectPerson?.(selfPartner.id)}>
						{@render avatar(selfPartner, '💞')}
						<span class="name">{selfPartner.name}</span>
					</button>
				{/if}
			</div>
			{#if selfChildren.length}
				<div class="v-line"></div>
				<div class="branch-children">
					{#each selfChildren as c (c.id)}
						<button class="node child" onclick={() => onSelectPerson?.(c.id)}>
							{@render avatar(c, '🧒')}
							<span class="name">{c.name}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Søskengrener -->
		{#each siblingUnits as unit (unit.primary.id)}
			<div class="branch">
				<div class="couple-row">
					<button class="node sibling" onclick={() => onSelectPerson?.(unit.primary.id)}>
						{@render avatar(unit.primary, '👥')}
						<span class="name">{unit.primary.name}</span>
					</button>
					{#if unit.partner}
						{@const partner = unit.partner}
						<span class="couple-bar"></span>
						<button class="node in-law" onclick={() => onSelectPerson?.(partner.id)}>
							{@render avatar(partner, '👤')}
							<span class="name">{partner.name}</span>
						</button>
					{/if}
				</div>
				{#if unit.children.length}
					<div class="v-line"></div>
					<div class="branch-children">
						{#each unit.children as c (c.id)}
							<button class="node extended" onclick={() => onSelectPerson?.(c.id)}>
								{@render avatar(c, '🌳')}
								<span class="name">{c.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Utvidet familie og venner -->
	{#if standaloneExtended.length}
		<div class="gen extended-row">
			{#each standaloneExtended as p (p.id)}
				<button class="node {p.kind}" onclick={() => onSelectPerson?.(p.id)}>
					{@render avatar(p, '🌳')}
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
		background: #0f0f18;
		border-radius: 14px;
		color: #dde1f0;
	}

	.gen {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
	}

	.parents-row { flex-wrap: wrap; align-items: center; }

	.v-line {
		width: 2px;
		height: 1.5rem;
		background: #3a3a5c;
		flex-shrink: 0;
	}

	.couple-bar {
		display: block;
		width: 1.1rem;
		height: 2px;
		background: #3a3a5c;
		flex-shrink: 0;
		align-self: center;
	}

	.branches-row {
		gap: 1.5rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.branch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.couple-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.branch-children {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
	}

	.extended-row {
		flex-wrap: wrap;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px dashed #2a2a44;
		gap: 0.5rem;
	}

	/* Noder */
	.node {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border-radius: 999px;
		border: 1.5px solid #2c2c4a;
		background: #16162a;
		color: #dde1f0;
		font: inherit;
		font-size: 0.83rem;
		cursor: pointer;
		transition: transform 0.1s, box-shadow 0.1s;
		white-space: nowrap;
	}

	.node:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	}

	.node.self {
		background: linear-gradient(135deg, #7c8ef5, #5f6fe0);
		border-color: transparent;
		color: #fff;
		cursor: default;
		font-weight: 600;
	}

	.node.partner  { border-color: #a0405f; }
	.node.child    { border-color: #9a6520; }
	.node.parent   { border-color: #335f99; }
	.node.sibling  { border-color: #236b4a; }
	.node.in-law   { border-color: #5f3a99; }
	.node.extended { border-color: #3a3a5c; }
	.node.friend   { border-color: #2a6a7a; }

	.emoji { font-size: 1rem; line-height: 1; }
	.avatar-photo {
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.name  { font-size: 0.82rem; }
</style>
