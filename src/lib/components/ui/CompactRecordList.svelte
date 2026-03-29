<script lang="ts">
	interface RecordItem {
		id: string;
		title: string;
		subtitle?: string;
		meta?: string;
		amount?: string;
		amountTone?: 'neutral' | 'positive' | 'negative';
	}

	interface Props {
		title: string;
		items: RecordItem[];
		emptyText?: string;
	}

	let { title, items, emptyText = 'Ingen data ennå.' }: Props = $props();
</script>

<section class="list-card" aria-label={title}>
	<header class="list-head">
		<h3>{title}</h3>
		<span>{items.length}</span>
	</header>

	{#if items.length === 0}
		<p class="list-empty">{emptyText}</p>
	{:else}
		<ul class="list-body">
			{#each items as item}
				<li class="list-item">
					<div class="list-main">
						<p class="list-title">{item.title}</p>
						{#if item.subtitle}<p class="list-sub">{item.subtitle}</p>{/if}
					</div>
					<div class="list-side">
						{#if item.amount}
							<p class="list-amount" class:is-positive={item.amountTone === 'positive'} class:is-negative={item.amountTone === 'negative'}>{item.amount}</p>
						{/if}
						{#if item.meta}<p class="list-meta">{item.meta}</p>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.list-card {
		border: 1px solid #262626;
		border-radius: 14px;
		background: #121212;
		padding: 14px;
	}

	.list-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 12px;
	}

	.list-head h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #ececec;
	}

	.list-head span {
		font-size: 0.76rem;
		color: #8b8b8b;
	}

	.list-empty {
		margin: 0;
		font-size: 0.86rem;
		color: #6f6f6f;
	}

	.list-body {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.list-item {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px;
		background: #171717;
		border-radius: 10px;
		border: 1px solid #232323;
	}

	.list-main {
		min-width: 0;
		flex: 1;
	}

	.list-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.35;
		color: #ebebeb;
	}

	.list-sub {
		margin: 3px 0 0;
		font-size: 0.8rem;
		line-height: 1.35;
		color: #9a9a9a;
	}

	.list-side {
		text-align: right;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.list-amount {
		margin: 0;
		font-size: 0.84rem;
		font-weight: 700;
		color: #d9d9d9;
	}

	.list-amount.is-positive {
		color: #74cf9e;
	}

	.list-amount.is-negative {
		color: #ee8c8c;
	}

	.list-meta {
		margin: 0;
		font-size: 0.74rem;
		color: #868686;
	}
</style>
