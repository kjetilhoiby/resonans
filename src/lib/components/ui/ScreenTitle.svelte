<script lang="ts">
	interface Props {
		title: string;
		subtitle?: string;
		emoji?: string | null;
		onpress?: () => void;
		ariaLabel?: string;
	}

	let { title, subtitle = '', emoji = null, onpress, ariaLabel = title }: Props = $props();
	const isClickable = $derived(typeof onpress === 'function');
</script>

{#if isClickable}
	<button class="screen-title" type="button" onclick={() => onpress?.()} aria-label={ariaLabel}>
		<div class="screen-title-row">
			{#if emoji}
				<span class="screen-title-emoji">{emoji}</span>
			{/if}
			<h1 class="screen-title-text">{title}</h1>
		</div>
		{#if subtitle}
			<p class="screen-title-sub">{subtitle}</p>
		{/if}
	</button>
{:else}
	<div class="screen-title" role="heading" aria-level="1">
		<div class="screen-title-row">
			{#if emoji}
				<span class="screen-title-emoji">{emoji}</span>
			{/if}
			<p class="screen-title-text">{title}</p>
		</div>
		{#if subtitle}
			<p class="screen-title-sub">{subtitle}</p>
		{/if}
	</div>
{/if}

<style>
	.screen-title {
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		color: inherit;
		text-align: left;
	}

	.screen-title-row {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}

	.screen-title-emoji {
		font-size: 1.6rem;
		line-height: 1;
	}

	.screen-title-text {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e8e8e8;
		margin: 0;
		line-height: 1.1;
	}

	.screen-title-sub {
		font-size: 0.8rem;
		color: #555;
		margin: 0;
		line-height: 1.5;
	}

	button.screen-title {
		cursor: pointer;
	}

	button.screen-title:focus-visible {
		outline: 2px solid #37457e;
		outline-offset: 4px;
		border-radius: 6px;
	}
</style>