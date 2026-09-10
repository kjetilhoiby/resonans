<script lang="ts">
	import AppPage from '$lib/components/ui/AppPage.svelte';
	import PageSection from '$lib/components/ui/PageSection.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import SickEpisodeView from '$lib/components/domain/health/SickEpisodeView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Sykdomsforløp · Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
		<!-- Tittelen ER tilbakeknappen, og den peker til Helse-temaet man kom fra. -->
		<PageHeader title="Sykdomsforløp" titleHref={data.backHref} emoji="🤒" />
		<SickEpisodeView episode={data.episode} />
	</PageSection>
</AppPage>
