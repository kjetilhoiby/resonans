<script lang="ts">
	import HomeScreen from '$lib/components/ui/HomeScreen.svelte';

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		data: { themes: Theme[] };
	}

	let { data }: Props = $props();
</script>

<HomeScreen themes={data.themes} />
