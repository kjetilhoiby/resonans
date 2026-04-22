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
		caption?: string;
		actionLabel?: string;
		onAction?: (() => void) | null;
		onItemClick?: ((itemId: string) => void) | null;
	}

	let {
		title,
		items,
		emptyText = 'Ingen data ennå.',
		caption = '',
		actionLabel = '',
		onAction = null,
		onItemClick = null
	}: Props = $props();

	function handleItemClick(itemId: string) {
		onItemClick?.(itemId);
	}
</script>

<section class="list-card" aria-label={title}>
	<header class="list-head">
		<div class="list-head-main">
			<h3>{title}</h3>
			{#if caption}
				<p class="list-caption">{caption}</p>
			{/if}
		</div>
		<div class="list-head-side">
			{#if onAction && actionLabel}
				<button class="list-action" type="button" onclick={onAction}>{actionLabel}</button>
			{/if}
			<span>{items.length}</span>
		</div>
	</header>

	{#if items.length === 0}
		<p class="list-empty">{emptyText}</p>
	{:else}
		<ul class="list-body">
			{#each items as item}
				<li class="list-item" class:list-item-clickable={Boolean(onItemClick)}>
					{#if onItemClick}
						<button class="list-item-btn" type="button" onclick={() => handleItemClick(item.id)}>
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
						</button>
					{:else}
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
					{/if}
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
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 12px;
	}

	.list-head-main {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.list-head-side {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
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

	.list-caption {
		margin: 0;
		font-size: 0.72rem;
		color: #707070;
	}

	.list-action {
		background: #171717;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 4px 8px;
		font: inherit;
		font-size: 0.72rem;
		color: #aaa;
		cursor: pointer;
	}

	.list-action:active {
		border-color: #3a4a85;
		color: #b8c4ff;
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

	.list-item-clickable {
		padding: 0;
		overflow: hidden;
	}

	.list-item-btn {
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		padding: 10px;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		cursor: pointer;
	}

	.list-item-btn:active {
		background: #1b1b1b;
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
