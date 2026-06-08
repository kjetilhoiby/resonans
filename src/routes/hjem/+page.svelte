<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage, PageHeader } from '$lib/components/ui';
	import HomeDashboard from '$lib/components/domain/HomeDashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function openProject(id: string) {
		goto(`/prosjekt/${id}`);
	}

	function openChat(prefill: string) {
		const params = new URLSearchParams({ prefill });
		goto(`/samtaler?${params.toString()}`);
	}
</script>

<svelte:head>
	<title>Hus og hjem · Resonans</title>
</svelte:head>

<AppPage>
	<PageHeader title="Hus og hjem" titleHref="/" />
	<HomeDashboard
		projects={data.projects}
		seasonalTasks={data.seasonalTasks}
		routines={data.routines}
		appliances={data.appliances}
		onOpenProject={openProject}
		onOpenChat={openChat}
	/>
</AppPage>
