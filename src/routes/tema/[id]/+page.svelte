<script lang="ts">
	import { AppPage } from '$lib/components/ui';
	import ThemePage from '$lib/components/domain/ThemePage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData & { selectedWorkout?: unknown } } = $props();
</script>

<AppPage width="full" padding="none" gap="sm" surface="transparent">
	{#if data.theme}
	<ThemePage
		theme={data.theme}
		initialMessages={data.messages}
		goals={data.goals}
		conversationId={data.conversationId}
		themeConversations={data.themeConversations}
		themeInstruction={data.themeInstruction}
		themeFiles={data.themeFiles}
		tripProfile={data.tripProfile}
		tripLists={data.tripLists}
		selectedWorkout={data.selectedWorkout}
	/>
	{/if}
</AppPage>
