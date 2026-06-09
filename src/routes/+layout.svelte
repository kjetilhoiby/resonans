<script lang="ts">
	import '../app.css';
	import { afterNavigate, onNavigate } from '$app/navigation';

	let { children } = $props();

	onNavigate((navigation) => {
		document.documentElement.classList.add('is-navigating');
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	afterNavigate(() => {
		document.documentElement.classList.remove('is-navigating');
	});
</script>

<svelte:head>
	<title>Resonans</title>
</svelte:head>

{@render children?.()}

