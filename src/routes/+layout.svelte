<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Resonans</title>
</svelte:head>

{@render children?.()}

