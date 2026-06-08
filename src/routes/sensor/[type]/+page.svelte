<script lang="ts">
	import { AppPage, PageSection } from '$lib/components/ui';
	import SensorDashboard from '$lib/components/domain/SensorDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AppPage>
	<PageSection>
		<SensorDashboard type={data.type} summary={data.summary} />
	</PageSection>
</AppPage>
