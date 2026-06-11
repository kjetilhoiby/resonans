<script lang="ts">
	import { goto } from '$app/navigation';
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
</script>

<svelte:head>
	<title>Årskavalkade — showet</title>
</svelte:head>

<KavalkadeShow {slides} onclose={() => goto('/kavalkade')} />
