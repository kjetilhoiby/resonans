<script lang="ts">
	import { AppPage, PageSection } from '$lib/components/ui';
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
				starred: boolean;
				archived: boolean;
				linkedTheme: { id: string; name: string; emoji: string | null } | null;
				updatedAt: string;
			}[];
			programReadiness?: {
				programId: string;
				programName: string;
				state: 'klar' | 'lett' | 'easy' | 'rest';
				alternativeName: string | null;
			} | null;
		};
	}

	let { data }: Props = $props();
</script>

<AppPage>
	<PageSection bleed>
		<HomeScreen
			themes={data.themes}
			recentConversations={data.recentConversations}
			programReadiness={data.programReadiness}
		/>
	</PageSection>
</AppPage>
