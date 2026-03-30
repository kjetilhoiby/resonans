<script lang="ts">
	interface Props {
		title?: string;
		children: import('svelte').Snippet;
	}

	let { title, children }: Props = $props();
</script>

<div class="section">
	{#if title}
		<h2 class="section-title">{title}</h2>
	{/if}
	<div class="section-content">
		{@render children()}
	</div>
</div>

<style>
	.section {
		background: #141414;
		border-radius: 18px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.section-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.section-content {
		display: flex;
		flex-direction: column;
	}
</style>
