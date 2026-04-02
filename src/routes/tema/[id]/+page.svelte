<script lang="ts">
	import ThemePage from '$lib/components/domain/ThemePage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData & { selectedWorkout?: unknown } } = $props();
</script>

<ThemePage
	theme={data.theme}
	initialMessages={data.messages}
	goals={data.goals}
	conversationId={data.conversationId}
	themeConversations={data.themeConversations}
	themeInstruction={data.themeInstruction}
	selectedWorkout={data.selectedWorkout}
/>
