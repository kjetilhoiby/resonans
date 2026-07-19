<!--
  LunchboxCard — «🥪 Matpakker» på mat-dashboardet. Per barn: dagens forslag
  som chips, «Pakk denne» / «Foreslå annet», og etter pakking tap-på-chip for
  retur-logging (tap = kom i retur, tap igjen = mer i retur, angre via ✕).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionCard from '../../ui/SectionCard.svelte';
	import LunchboxPrefsSheet from './LunchboxPrefsSheet.svelte';
	import { KIND_META, type ComponentKind } from '$lib/domains/food/lunchbox';

	type Item = { componentId?: string; name: string; kind: string };
	type Child = {
		personId: string;
		name: string;
		avatarEmoji: string | null;
		photoUrl: string | null;
		profile: { likes: string[]; dislikes: string[]; allergies: string[]; appetite: string; notes: string | null };
		entry: { id: string; items: Item[]; packedAt: string | null; source: string } | null;
		suggestion: { items: Array<Item & { reason: string | null }>; sliceCount: number } | null;
		returnsToday: Array<{ id: string; itemName: string; quantity: number | null; degree: string }>;
	};
	type Component = { id: string; name: string; kind: string; tags: string[]; active: boolean };

	let date = $state('');
	let children = $state<Child[]>([]);
	let components = $state<Component[]>([]);
	let loading = $state(true);
	// Ett globalt shuffle-seed: API-et regenererer alle upakkede barns forslag samlet
	let shuffleSeed = $state(0);
	let prefsChild = $state<Child | null>(null);

	onMount(load);

	async function load(seed?: number) {
		const params = new URLSearchParams();
		if (seed !== undefined) params.set('seed', String(seed));
		const res = await fetch(`/api/food/lunchbox${params.size ? `?${params}` : ''}`);
		if (res.ok) {
			const data = await res.json();
			date = data.date;
			children = data.children;
			components = data.components;
		}
		loading = false;
	}

	function emoji(kind: string): string {
		return KIND_META[kind as ComponentKind]?.emoji ?? '🥪';
	}

	async function pack(child: Child) {
		if (!child.suggestion) return;
		await fetch('/api/food/lunchbox/entries', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				personId: child.personId,
				date,
				items: child.suggestion.items.map(({ componentId, name, kind }) => ({ componentId, name, kind })),
				source: 'suggested',
				packed: true
			})
		});
		await load();
	}

	async function reshuffle() {
		shuffleSeed += 1;
		await load(shuffleSeed);
	}

	function returnsFor(child: Child, item: Item) {
		return child.returnsToday.filter(
			(r) => r.itemName.toLowerCase() === item.name.toLowerCase()
		);
	}

	async function logReturn(child: Child, item: Item) {
		await fetch('/api/food/lunchbox/returns', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				personId: child.personId,
				date,
				entryId: child.entry?.id,
				componentId: item.componentId,
				itemName: item.name,
				degree: 'noe'
			})
		});
		await load();
	}

	async function undoReturn(returnId: string) {
		await fetch(`/api/food/lunchbox/returns?id=${returnId}`, { method: 'DELETE' });
		await load();
	}
</script>

{#if !loading && (children.length > 0 || components.length > 0)}
	<SectionCard tone="subtle" title="🥪 Matpakker">
		{#if children.length === 0}
			<p class="lb-empty">Legg inn barna som personer (kind «barn») for å få matpakke-forslag.</p>
		{:else if components.length === 0}
			<p class="lb-empty">
				Legg inn pålegg, frukt og grønt i komponentbiblioteket, så foreslår vi matpakker per barn.
				<button class="lb-link" onclick={() => (prefsChild = children[0])}>Kom i gang</button>
			</p>
		{:else}
			<div class="lb-children">
				{#each children as child (child.personId)}
					<div class="lb-child">
						<div class="lb-child-head">
							<span class="lb-avatar">
								{#if child.photoUrl}
									<img src={child.photoUrl} alt={child.name} />
								{:else}
									{child.avatarEmoji ?? '🧒'}
								{/if}
							</span>
							<span class="lb-name">{child.name}</span>
							{#if child.entry?.packedAt}
								<span class="lb-status">pakket ✓</span>
							{:else if child.suggestion}
								<span class="lb-status lb-status-suggested">{child.suggestion.sliceCount} skiver</span>
							{/if}
							<button
								class="lb-prefs"
								onclick={() => (prefsChild = child)}
								aria-label={`Preferanser for ${child.name}`}
								data-track="matpakke:preferanser"
							>⚙</button>
						</div>

						{#if child.entry}
							<!-- Pakket: chips er retur-logging -->
							<div class="lb-chips">
								{#each child.entry.items as item}
									{@const returns = returnsFor(child, item)}
									<button
										class="lb-chip"
										class:returned={returns.length > 0}
										onclick={() => logReturn(child, item)}
										aria-label={`Logg retur: ${item.name}`}
										data-track="matpakke:retur"
									>
										{emoji(item.kind)} {item.name}
										{#if returns.length > 0}
											<span class="lb-return-count">retur ×{returns.length}</span>
										{/if}
									</button>
									{#if returns.length > 0}
										<button
											class="lb-undo"
											onclick={() => undoReturn(returns[returns.length - 1].id)}
											aria-label={`Angre retur: ${item.name}`}
											data-track="matpakke:angre-retur"
										>✕</button>
									{/if}
								{/each}
							</div>
							{#if child.entry.items.length > 0}
								<p class="lb-hint">Tapp det som kom i retur — det lærer forslagene hva som funker.</p>
							{/if}
						{:else if child.suggestion && child.suggestion.items.length > 0}
							<div class="lb-chips">
								{#each child.suggestion.items as item}
									<span class="lb-chip lb-chip-static" title={item.reason ?? undefined}>
										{emoji(item.kind)} {item.name}
									</span>
								{/each}
							</div>
							<div class="lb-actions">
								<button class="lb-action lb-primary" onclick={() => pack(child)} data-track="matpakke:pakk">
									Pakk denne
								</button>
								<button class="lb-action" onclick={reshuffle} data-track="matpakke:nytt-forslag">
									Foreslå annet
								</button>
							</div>
						{:else}
							<p class="lb-hint">Ingen forslag — sjekk at komponentbiblioteket har varer barnet tåler/liker.</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</SectionCard>
{/if}

{#if prefsChild}
	<LunchboxPrefsSheet
		child={prefsChild}
		{components}
		onclose={() => (prefsChild = null)}
		onchanged={() => { prefsChild = null; void load(); }}
	/>
{/if}

<style>
	.lb-empty {
		margin: 0;
		color: var(--color-text-secondary, #999);
		font-size: 0.88rem;
		line-height: 1.5;
	}
	.lb-link {
		background: none;
		border: none;
		color: var(--accent-light);
		cursor: pointer;
		text-decoration: underline;
		font-size: 0.88rem;
		padding: 0;
	}
	.lb-children {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.lb-child {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.lb-child-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.lb-avatar {
		font-size: 1.15rem;
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.lb-avatar img {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		object-fit: cover;
	}
	.lb-name {
		font-weight: 600;
		font-size: 0.92rem;
		flex: 1;
	}
	.lb-status {
		font-size: 0.74rem;
		color: var(--success-text);
	}
	.lb-status-suggested {
		color: var(--color-text-secondary, #999);
	}
	.lb-prefs {
		background: none;
		border: none;
		color: var(--color-text-secondary, #888);
		cursor: pointer;
		font-size: 0.95rem;
		padding: 4px;
	}
	.lb-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.lb-chip {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		color: inherit;
		padding: 7px 12px;
		font-size: 0.84rem;
		cursor: pointer;
	}
	.lb-chip-static {
		cursor: default;
	}
	.lb-chip.returned {
		background: rgba(224, 112, 112, 0.14);
		border-color: rgba(224, 112, 112, 0.4);
	}
	.lb-return-count {
		color: var(--error-text);
		font-size: 0.74rem;
		margin-left: 4px;
	}
	.lb-undo {
		background: none;
		border: none;
		color: var(--color-text-secondary, #888);
		cursor: pointer;
		font-size: 0.72rem;
		padding: 2px;
	}
	.lb-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary, #888);
	}
	.lb-actions {
		display: flex;
		gap: 8px;
	}
	.lb-action {
		background: rgba(255, 255, 255, 0.07);
		border: none;
		border-radius: 10px;
		color: inherit;
		padding: 9px 14px;
		font-size: 0.84rem;
		font-weight: 600;
		cursor: pointer;
	}
	.lb-primary {
		background: color-mix(in srgb, var(--accent-light) 18%, transparent);
		color: var(--accent-light);
	}
</style>
