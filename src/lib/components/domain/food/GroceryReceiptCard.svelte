<!--
  GroceryReceiptCard — siste dagligvarehandel (Oda-ordre eller Rema-kvittering)
  på mat-dashboardet: totalsum,
  «Legg i lager»-knapp (ett trykk, ikke automatikk), ekspanderbare varelinjer
  per kategori, og plan-vs-kjøp («kjøpte vi det vi planla?»).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionCard from '../../ui/SectionCard.svelte';
	import { GROCERY_CATEGORY_META, type GroceryCategory, type PlanVsPurchase } from '$lib/domains/food/grocery';

	type Line = {
		id: string;
		name: string;
		quantity: string | null;
		unit: string | null;
		totalPrice: string | null;
		category: string;
		pantryItemId: string | null;
	};
	type Order = {
		id: string;
		provider: string;
		storeName: string | null;
		purchasedAt: string | null;
		kind: string;
		orderRef: string | null;
		deliveryDate: string | null;
		weekContext: string;
		totalAmount: string | null;
		pantryAppliedAt: string | null;
		lines: Line[];
	};

	let order = $state<Order | null>(null);
	let comparison = $state<PlanVsPurchase | null>(null);
	/** Plan-mot-kjøp gjelder hele uka; flere handler sies, så tallene ikke leses som denne kvitteringen. */
	let ordersInWeek = $state(1);
	let expanded = $state(false);
	let applying = $state(false);
	let loading = $state(true);

	onMount(load);

	async function load() {
		const res = await fetch('/api/food/grocery-orders');
		if (res.ok) {
			const data = await res.json();
			order = data.orders?.[0] ?? null;
			if (order) {
				const cmpRes = await fetch(`/api/food/grocery-orders/${order.id}/comparison`);
				if (cmpRes.ok) {
					const cmp = await cmpRes.json();
					comparison = cmp.comparison;
					ordersInWeek = cmp.ordersInWeek ?? 1;
				}
			}
		}
		loading = false;
	}

	async function applyPantry() {
		if (!order || applying) return;
		applying = true;
		try {
			await fetch(`/api/food/grocery-orders/${order.id}/apply-pantry`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			await load();
		} finally {
			applying = false;
		}
	}

	function formatAmount(value: string | null): string {
		if (!value) return '–';
		return `${Math.round(Number(value)).toLocaleString('no-NO')} kr`;
	}

	function categoryMeta(category: string) {
		return GROCERY_CATEGORY_META[category as GroceryCategory] ?? GROCERY_CATEGORY_META.annet;
	}

	const PROVIDER_LABEL: Record<string, string> = { oda: 'Oda', rema1000: 'Rema 1000' };
	const providerLabel = $derived(order ? (PROVIDER_LABEL[order.provider] ?? order.provider) : '');

	const linesByCategory = $derived.by(() => {
		if (!order) return [];
		const groups = new Map<string, Line[]>();
		for (const line of order.lines) {
			const list = groups.get(line.category) ?? [];
			list.push(line);
			groups.set(line.category, list);
		}
		return Array.from(groups.entries());
	});
</script>

{#if !loading && order}
	<SectionCard tone="subtle" title={`🧾 Siste handel · ${order.storeName ?? providerLabel}`}>
		<div class="gr-head">
			<div class="gr-copy">
				<span class="gr-title">
					{order.kind === 'order_confirmation' ? 'Ordrebekreftelse' : 'Kvittering'}
					· uke {order.weekContext.split('-W')[1]}
				</span>
				<span class="gr-sub">
					{order.lines.length} varer · {formatAmount(order.totalAmount)}
					{#if order.deliveryDate}· levert {order.deliveryDate}{/if}
					{#if order.purchasedAt}· {new Date(order.purchasedAt).toLocaleString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{/if}
				</span>
			</div>
			{#if !order.pantryAppliedAt}
				<button class="gr-apply" onclick={applyPantry} disabled={applying} data-track="kvittering:legg-i-lager">
					{applying ? 'Legger inn…' : 'Legg i lager'}
				</button>
			{:else}
				<span class="gr-applied">i lager ✓</span>
			{/if}
		</div>

		{#if comparison}
			<div class="gr-comparison">
				{#if ordersInWeek > 1}<span class="gr-cmp-item gr-muted">Ukelista mot alle {ordersInWeek} handler i uka:</span>{/if}
				<span class="gr-cmp-item">✅ Som planlagt ({comparison.bought.length})</span>
				{#if comparison.missing.length > 0}
					<span class="gr-cmp-item gr-warn">⚠️ Manglet ({comparison.missing.length}: {comparison.missing.slice(0, 3).join(', ')}{comparison.missing.length > 3 ? '…' : ''})</span>
				{/if}
				{#if comparison.impulse.length > 0}
					<span class="gr-cmp-item">🛒 Utenom lista ({comparison.impulse.length})</span>
				{/if}
			</div>
		{/if}

		<button class="gr-toggle" onclick={() => (expanded = !expanded)} data-track="kvittering:vis-varelinjer">
			{expanded ? 'Skjul varelinjer' : 'Vis varelinjer'}
		</button>

		{#if expanded}
			<div class="gr-lines">
				{#each linesByCategory as [category, lines]}
					<div class="gr-group">
						<span class="gr-group-label">{categoryMeta(category).emoji} {categoryMeta(category).label}</span>
						<ul>
							{#each lines as line}
								<li class="gr-line">
									<span class="gr-line-name">
										{line.name}
										{#if line.quantity}<span class="gr-muted"> ×{line.quantity}{line.unit ? ` ${line.unit}` : ''}</span>{/if}
									</span>
									{#if line.totalPrice}<span class="gr-muted">{Number(line.totalPrice).toFixed(0)} kr</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	</SectionCard>
{/if}

<style>
	.gr-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.gr-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.gr-title {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.gr-sub {
		font-size: 0.78rem;
		color: var(--color-text-secondary, #999);
	}
	.gr-apply {
		background: color-mix(in srgb, var(--accent-light) 18%, transparent);
		border: none;
		border-radius: 10px;
		color: var(--accent-light);
		padding: 9px 14px;
		font-size: 0.84rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.gr-applied {
		color: var(--success-text);
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.gr-comparison {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin-top: 10px;
		font-size: 0.8rem;
	}
	.gr-warn {
		color: var(--warning-text);
	}
	.gr-toggle {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		font-size: 0.78rem;
		padding: 8px 0 0;
		text-decoration: underline;
	}
	.gr-lines {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 10px;
	}
	.gr-group-label {
		font-size: 0.74rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary, #999);
	}
	.gr-group ul {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
	}
	.gr-line {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 3px 0;
		font-size: 0.85rem;
	}
	.gr-muted {
		color: var(--color-text-secondary, #888);
		font-size: 0.78rem;
	}
</style>
