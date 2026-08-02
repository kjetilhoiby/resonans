<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import ScreenTimeDashboard from '$lib/components/domain/ScreenTimeDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Skjermtid · Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
		<PageHeader title="Skjermtid" titleHref="/" />
		<ScreenTimeDashboard {data} />
	</PageSection>
</AppPage>
