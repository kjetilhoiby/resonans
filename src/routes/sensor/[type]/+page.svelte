<script lang="ts">
	import SensorDashboard from '$lib/components/ui/SensorDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SensorDashboard type={data.type} summary={data.summary} />
