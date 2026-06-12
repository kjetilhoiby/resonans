<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		KavalkadeShow,
		buildShowSlides,
		type ShowInput
	} from '$lib/components/domain/kavalkade';

	interface Props {
		data: ShowInput;
	}

	let { data }: Props = $props();

	const slides = $derived(buildShowSlides(data));
	// Festskinn-utkast: /kavalkade/show?skin=fest
	const skin = $derived(page.url.searchParams.get('skin') === 'fest' ? 'fest' as const : 'dark' as const);
</script>

<svelte:head>
	<title>Årskavalkade — showet</title>
</svelte:head>

<KavalkadeShow {slides} {skin} onclose={() => goto('/kavalkade')} />
