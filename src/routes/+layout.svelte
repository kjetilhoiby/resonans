<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Resonans - Din personlige målcoach</title>
</svelte:head>

{@render children?.()}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
	}
</style>

