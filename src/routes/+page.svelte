<script lang="ts">
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

<HomeScreen themes={data.themes} recentConversations={data.recentConversations} />
