<script lang="ts">
	import { AppPage } from '$lib/components/ui';
	import SensorDashboard from '$lib/components/domain/SensorDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AppPage width="full" padding="none" gap="sm" surface="default">
	<SensorDashboard type={data.type} summary={data.summary} />
</AppPage>
