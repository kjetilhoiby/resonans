<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import TrainingDashboard from '$lib/components/domain/TrainingDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Trening" subtitle="To løp — styrke og utholdenhet" titleHref="/" />
		<TrainingDashboard {data} />
	</PageSection>
</AppPage>
