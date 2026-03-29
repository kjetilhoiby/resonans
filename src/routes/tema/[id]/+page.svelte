<script lang="ts">
	import ThemePage from '$lib/components/ui/ThemePage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<ThemePage
	theme={data.theme}
	initialMessages={data.messages}
	goals={data.goals}
	conversationId={data.conversationId}
	themeConversations={data.themeConversations}
	healthDashboard={data.healthDashboard}
	economicsDashboard={data.economicsDashboard}
	themeInstruction={data.themeInstruction}
/>
