<script lang="ts">
	import HealthDashboard from '$lib/components/ui/HealthDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Helse - Resonans</title>
</svelte:head>

<div class="container">
	<HealthDashboard
		weekly={data.weekly}
		monthly={data.monthly}
		yearly={data.yearly}
		sources={data.sources}
		recentEvents={data.recentEvents}
	/>
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

</style>
