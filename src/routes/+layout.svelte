<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>Resonans - Din personlige målcoach</title>
</svelte:head>

{@render children?.()}

