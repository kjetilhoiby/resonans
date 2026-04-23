<script lang="ts">
	import { AppPage } from '$lib/components/ui';
	import HomeScreen from '$lib/components/domain/HomeScreen.svelte';

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		data: {
			themes: Theme[];
			recentConversations: {
				id: string;
				title: string;
				preview: string;
				updatedAt: string;
			}[];
		};
	}

	let { data }: Props = $props();
</script>

<AppPage width="full" padding="none" gap="sm" surface="transparent">
	<HomeScreen themes={data.themes} recentConversations={data.recentConversations} />
</AppPage>
