<script lang="ts">
	import { AppPage, PageSection, PullToRefresh } from '$lib/components/ui';
	import ThemePage from '$lib/components/domain/ThemePage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData & { selectedWorkout?: unknown } } = $props();

	let themePage: { refresh: () => Promise<void> } | undefined = $state();

	async function refreshTheme() {
		await themePage?.refresh();
	}
</script>

<AppPage>
	<PageSection bleed>
	<PullToRefresh onRefresh={refreshTheme}>
	{#if data.theme}
	<!-- Key på tema-id: /tema/[id] er én rute, så SvelteKit gjenbruker ellers
	     samme ThemePage-instans ved navigasjon mellom temaer. Da re-synkes ikke
	     intern state som currentFerieProfile/currentTripProfile (settes kun ved
	     mount), og en åpnet ferie kunne vise tom oppholdsplan selv om data fantes.
	     Keyen tvinger full remount per tema. -->
	{#key data.theme.id}
	<ThemePage
		bind:this={themePage}
		theme={data.theme}
		initialMessages={data.messages}
		goals={data.goals}
		conversationId={data.conversationId}
		themeConversations={data.themeConversations}
		themeInstruction={data.themeInstruction}
		themeFiles={data.themeFiles}
		tripProfile={data.tripProfile}
		ferieProfile={data.ferieProfile}
		tripLists={data.tripLists}
		selectedWorkout={data.selectedWorkout}
		metricSettings={data.metricSettings}
		projects={data.projects}
		isHomeProject={data.isHomeProject}
		projectProfile={data.projectProfile}
		tasks={data.tasks}
		cutLists={data.cutLists}
	/>
	{/key}
	{/if}
	</PullToRefresh>
	</PageSection>
</AppPage>
