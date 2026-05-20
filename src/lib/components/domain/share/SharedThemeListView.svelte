<script lang="ts">
	type Item = {
		id: string;
		text: string;
		checked: boolean;
		notes: string | null;
		itemDate: string | null;
		sortOrder: number;
		checkedAt: Date | string | null;
		checkedViaShareTokenId: string | null;
	};
	type Resource = {
		kind: 'themeList';
		id: string;
		title: string;
		emoji: string;
		listType: string;
		themeName: string | null;
		items: Item[];
	};

	let {
		token,
		resource,
		accessMode
	}: { token: string; resource: Resource; accessMode: 'read' | 'write' } = $props();

	let items = $state<Item[]>(resource.items.map((it) => ({ ...it })));
	let pendingIds = $state<Set<string>>(new Set());
	let errorMessage = $state<string | null>(null);

	async function toggle(item: Item) {
		if (accessMode !== 'write') return;
		if (pendingIds.has(item.id)) return;
		const nextChecked = !item.checked;

		items = items.map((it) =>
			it.id === item.id ? { ...it, checked: nextChecked, checkedAt: nextChecked ? new Date() : null } : it
		);
		pendingIds = new Set([...pendingIds, item.id]);
		errorMessage = null;

		try {
			const res = await fetch(`/api/share-link/${token}/check-item`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, checked: nextChecked })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		} catch (err) {
			items = items.map((it) =>
				it.id === item.id ? { ...it, checked: !nextChecked, checkedAt: item.checkedAt } : it
			);
			errorMessage = 'Kunne ikke lagre. Prøv igjen.';
			console.error(err);
		} finally {
			const next = new Set(pendingIds);
			next.delete(item.id);
			pendingIds = next;
		}
	}

	const completedCount = $derived(items.filter((it) => it.checked).length);
</script>

<section class="theme-list">
	<h1>
		<span class="emoji">{resource.emoji}</span>
		{resource.title}
	</h1>
	<p class="meta">
		{#if resource.themeName}<span>{resource.themeName}</span> · {/if}
		{completedCount} av {items.length} fullført
		{#if accessMode === 'read'}<span class="badge">Lesetilgang</span>{/if}
	</p>

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	<ul>
		{#each items as item (item.id)}
			<li class:checked={item.checked}>
				<label>
					<input
						type="checkbox"
						checked={item.checked}
						disabled={accessMode !== 'write' || pendingIds.has(item.id)}
						onchange={() => toggle(item)}
					/>
					<span class="content">
						{#if item.itemDate}<span class="date">{item.itemDate}</span>{/if}
						<span class="text">{item.text}</span>
						{#if item.notes}<span class="notes">{item.notes}</span>{/if}
					</span>
				</label>
			</li>
		{/each}
	</ul>
</section>

<style>
	.theme-list h1 {
		font-size: 1.5rem;
		margin: 0 0 0.25rem;
	}
	.emoji {
		margin-right: 0.4rem;
	}
	.meta {
		color: #666;
		font-size: 0.85rem;
		margin: 0 0 1rem;
	}
	.badge {
		background: #eee;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		margin-left: 0.5rem;
		font-size: 0.75rem;
	}
	.error {
		background: #fff2f2;
		border: 1px solid #f5c2c2;
		color: #b00020;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		padding: 0.6rem 0;
		border-bottom: 1px solid #eee;
	}
	li.checked .text {
		text-decoration: line-through;
		color: #999;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		cursor: pointer;
	}
	input[type='checkbox'] {
		width: 1.2rem;
		height: 1.2rem;
		margin-top: 0.15rem;
		flex-shrink: 0;
	}
	input[type='checkbox']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.content {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.date {
		font-size: 0.75rem;
		color: #999;
	}
	.text {
		line-height: 1.4;
	}
	.notes {
		font-size: 0.8rem;
		color: #666;
		margin-top: 0.2rem;
	}
</style>
